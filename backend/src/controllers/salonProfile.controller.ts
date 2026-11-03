// backend/src/controllers/salonProfile.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { updateSalonProfileBodySchema } from '../validators/salonProfile.validators';
import { getSalonProfile, updateSalonProfile } from '../services/salonProfile.service';
import { broadcastQueueUpdate } from '../services/queue.service';

function salonIdOf(req: Request): string {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return req.staff.salonId;
}

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const salon = await getSalonProfile(salonIdOf(req));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ salon });
  } catch (err) {
    next(err);
  }
}

export async function patchProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const patch = updateSalonProfileBodySchema.parse(req.body);
    const salon = await updateSalonProfile(salonId, patch);
    // Customers' open tracking pages re-fetch, so a new service time shows up live.
    await broadcastQueueUpdate(salonId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ salon });
  } catch (err) {
    next(err);
  }
}