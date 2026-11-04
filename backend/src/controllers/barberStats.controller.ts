import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { getBarberStats } from '../services/barberStats.service';

export async function getStats(req: Request, res: Response, next: NextFunction) {
  try {
    // salonId comes only from the authenticated session. The endpoint reads no body or query.
    if (!req.staff) throw new AppError('Not authenticated.', 401);
    const stats = await getBarberStats(req.staff.salonId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ stats });
  } catch (err) {
    next(err);
  }
}