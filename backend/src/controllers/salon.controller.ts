import { Request, Response, NextFunction } from 'express';
import { nearbySalonsQuerySchema, salonIdParamSchema } from '../validators/salon.validators';
import { findNearbySalons, getSalonById, getSalonQueueSnapshot } from '../services/salon.service';

export async function getNearbySalons(req: Request, res: Response, next: NextFunction) {
  try {
    const { lat, lng, radiusKm } = nearbySalonsQuerySchema.parse(req.query);
    const salons = await findNearbySalons(lat, lng, radiusKm);
    res.json({ salons });
  } catch (err) {
    next(err);
  }
}

export async function getSalonDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = salonIdParamSchema.parse(req.params);
    const salon = await getSalonById(salonId);
    if (!salon) return res.status(404).json({ message: 'Salon not found.' });
    res.json({ salon });
  } catch (err) {
    next(err);
  }
}

export async function getSalonQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = salonIdParamSchema.parse(req.params);
    const snapshot = await getSalonQueueSnapshot(salonId);
    res.json(snapshot);
  } catch (err) {
    next(err);
  }
}