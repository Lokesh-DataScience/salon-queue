// backend/src/controllers/barber.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { entryIdParamSchema } from '../validators/barber.validators';
import {
  getBarberQueueSnapshot,
  callNext,
  startEntry,
  completeEntry,
  skipEntry,
  pauseQueue,
  resumeQueue,
  addWalkIn,
} from '../services/barber.service';
import { broadcastQueueUpdate } from '../services/queue.service';
import { AppError } from '../middleware/errorHandler';
import { NotificationService } from '../services/notification.service';

function salonIdOf(req: Request): string {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return req.staff.salonId;
}

export async function getQueue(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getBarberQueueSnapshot(salonIdOf(req)));
  } catch (err) {
    next(err);
  }
}

export async function postNext(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const result = await callNext(salonId);
    await broadcastQueueUpdate(salonId); // NEW
    res.json({ result });
  } catch (err) {
    next(err);
  }
}

export async function postStart(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const { entryId } = entryIdParamSchema.parse(req.params);
    const entry = await startEntry(salonId, entryId);
    await broadcastQueueUpdate(salonId); // NEW
    res.json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function postComplete(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const { entryId } = entryIdParamSchema.parse(req.params);
    const entry = await completeEntry(salonId, entryId);
    await broadcastQueueUpdate(salonId); // NEW
    res.json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function postSkip(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const { entryId } = entryIdParamSchema.parse(req.params);
    const entry = await skipEntry(salonId, entryId);
    await broadcastQueueUpdate(salonId); // NEW
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
    const salonId = salonIdOf(req);
    const queue = await pauseQueue(salonId);
    await broadcastQueueUpdate(salonId); // NEW
    res.json({ queue });
  } catch (err) {
    next(err);
  }
}

export async function postResume(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const queue = await resumeQueue(salonId);
    await broadcastQueueUpdate(salonId); // NEW
    res.json({ queue });
  } catch (err) {
    next(err);
  }
}

export async function postWalkIn(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req); // always from the verified session, never the body
    const entry = await addWalkIn(salonId);
    await broadcastQueueUpdate(salonId); // customers' "people ahead" updates live
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
}