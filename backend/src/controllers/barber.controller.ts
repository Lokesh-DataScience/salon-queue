// backend/src/controllers/barber.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { entryIdParamSchema, laneQuerySchema } from '../validators/barber.validators';
import {
  getBarberQueueSnapshot,
  callNext,
  startEntry,
  completeEntry,
  skipEntry,
  pauseForScope,
  resumeForScope,
  addWalkIn,
  moveToFront,
  markNotHere,
  assertEntryAccess,
} from '../services/barber.service';
import { resolveScope } from '../services/barberScope.service';
import { broadcastQueueUpdate } from '../services/queue.service';
import { AppError } from '../middleware/errorHandler';
import { NotificationService } from '../services/notification.service';
import { advanceSalonQueue, extendEntry } from '../services/queueAutomation.service';
import { extendBodySchema } from '../validators/barber.validators';
import { redeemPrizeForEntry } from '../services/offers.service';

// Who is asking and which barber's line this is about (see barberScope.service.ts).
// The line comes from the database for staff; only the owner may name another with ?laneId=.
async function scopeOf(req: Request) {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  const { laneId } = laneQuerySchema.parse(req.query);
  return resolveScope(req.staff, laneId);
}

export async function getQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    await advanceSalonQueue(scope.salonId).catch(() => {});
    res.json(await getBarberQueueSnapshot(scope));
  } catch (err) {
    next(err);
  }
}

export async function postNext(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    const result = await callNext(scope);
    await broadcastQueueUpdate(scope.salonId);
    res.json({ result });
  } catch (err) {
    next(err);
  }
}

export async function postStart(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    const { entryId } = entryIdParamSchema.parse(req.params);
    const entry = await startEntry(scope.salonId, entryId, scope.entryLaneId);
    await broadcastQueueUpdate(scope.salonId);
    res.json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function postComplete(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    const { entryId } = entryIdParamSchema.parse(req.params);
    const entry = await completeEntry(scope.salonId, entryId, scope.entryLaneId);
    await advanceSalonQueue(scope.salonId);
    await broadcastQueueUpdate(scope.salonId);
    res.json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function postSkip(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    const { salonId } = scope;
    const { entryId } = entryIdParamSchema.parse(req.params);
    const entry = await skipEntry(salonId, entryId, scope.entryLaneId);
    await advanceSalonQueue(salonId);
    await broadcastQueueUpdate(salonId);
    if (entry.previousStatus === 'WAITING' || entry.previousStatus === 'CALLED') {
      await NotificationService.notifyQueueCancelled({
        entryId, salonId, tokenNumber: entry.tokenNumber,
      });
    }
    res.json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function postPause(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    const queue = await pauseForScope(scope);
    await broadcastQueueUpdate(scope.salonId);
    res.json({ queue });
  } catch (err) {
    next(err);
  }
}

export async function postResume(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    const queue = await resumeForScope(scope);
    await broadcastQueueUpdate(scope.salonId);
    res.json({ queue });
  } catch (err) {
    next(err);
  }
}

export async function postWalkIn(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req); // salon and line come from the session, never the body
    const entry = await addWalkIn(scope);
    await advanceSalonQueue(scope.salonId);
    await broadcastQueueUpdate(scope.salonId); // customers' "people ahead" updates live
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function postExtend(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    const { salonId } = scope;
    const { entryId } = entryIdParamSchema.parse(req.params);
    const { minutes } = extendBodySchema.parse(req.body ?? {});
    await assertEntryAccess(salonId, entryId, scope.entryLaneId); // staff: their own line only
    const result = await extendEntry(salonId, entryId, minutes);
    await broadcastQueueUpdate(salonId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function postPrioritize(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req); // from the verified session only
    const { salonId } = scope;
    const { entryId } = entryIdParamSchema.parse(req.params);
    const entry = await moveToFront(salonId, entryId, scope.entryLaneId);
    await broadcastQueueUpdate(salonId);
    res.json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function postRedeemPrize(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    const { entryId } = entryIdParamSchema.parse(req.params);
    const result = await redeemPrizeForEntry(scope.salonId, entryId, scope.entryLaneId);
    await broadcastQueueUpdate(scope.salonId); // the customer's prize card flips to "Redeemed"
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// "Not here": an app customer who is not at the salon. First time back 2 places, second time cancelled.
export async function postNotHere(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req); // from the verified session only
    const { salonId } = scope;
    const { entryId } = entryIdParamSchema.parse(req.params);
    const entry = await markNotHere(salonId, entryId, scope.entryLaneId);
    await advanceSalonQueue(salonId); // the next customer starts now
    await broadcastQueueUpdate(salonId);
    const target = { entryId, salonId, tokenNumber: entry.tokenNumber };
    if (entry.action === 'moved_back') await NotificationService.notifyMovedBack(target);
    else await NotificationService.notifyQueueCancelled(target);
    res.json({ entry });
  } catch (err) {
    next(err);
  }
}
