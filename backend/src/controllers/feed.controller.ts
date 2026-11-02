// backend/src/controllers/feed.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { getFeedForSalon } from '../services/news.service';
import { reverseGeocode } from '../services/geocode.service';
import { reverseGeoQuerySchema, salonIdParamSchema } from '../validators/feed.validators';

export async function getSalonFeed(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = salonIdParamSchema.safeParse(req.params);
    if (!parsed.success) throw new AppError('Salon not found.', 404);
    const items = await getFeedForSalon(parsed.data.salonId);
    res.set('Cache-Control', 'public, max-age=300').json({ items });
  } catch (err) {
    next(err);
  }
}

export async function getReverseGeocode(req: Request, res: Response, next: NextFunction) {
  try {
    const { lat, lng } = reverseGeoQuerySchema.parse(req.query);
    let place;
    try {
      place = await reverseGeocode(lat, lng);
    } catch {
      throw new AppError('We could not look up the area. Please type it in.', 502);
    }
    res.json({ place });
  } catch (err) {
    next(err);
  }
}