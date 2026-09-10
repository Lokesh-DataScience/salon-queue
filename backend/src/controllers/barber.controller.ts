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
} from '../services/barber.service';
import { AppError } from '../middleware/errorHandler';

// req.staff is guaranteed present here because every route in
// barber.routes.ts runs requireAuth first. salonId is ALWAYS read from
// the verified JWT, never from params/body/query — this is the
// ownership guarantee for the salon-level actions (next/pause/resume).
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
    const result = await callNext(salonIdOf(req));
    res.json({ result });
  } catch (err) {
    next(err);
  }
}

export async function postStart(req: Request, res: Response, next: NextFunction) {
  try {
    const { entryId } = entryIdParamSchema.parse(req.params);
    res.json({ entry: await startEntry(salonIdOf(req), entryId) });
  } catch (err) {
    next(err);
  }
}

export async function postComplete(req: Request, res: Response, next: NextFunction) {
  try {
    const { entryId } = entryIdParamSchema.parse(req.params);
    res.json({ entry: await completeEntry(salonIdOf(req), entryId) });
  } catch (err) {
    next(err);
  }
}

export async function postSkip(req: Request, res: Response, next: NextFunction) {
  try {
    const { entryId } = entryIdParamSchema.parse(req.params);
    res.json({ entry: await skipEntry(salonIdOf(req), entryId) });
  } catch (err) {
    next(err);
  }
}

export async function postPause(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ queue: await pauseQueue(salonIdOf(req)) });
  } catch (err) {
    next(err);
  }
}

export async function postResume(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ queue: await resumeQueue(salonIdOf(req)) });
  } catch (err) {
    next(err);
  }
}