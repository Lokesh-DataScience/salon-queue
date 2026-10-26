// backend/src/controllers/salon.controller.ts
import { Request, Response, NextFunction } from 'express';
import { nearbySalonsQuerySchema, salonIdParamSchema, salonCodeParamSchema } from '../validators/salon.validators';
import { findNearbySalons, getSalonById, getSalonByQrCode, getSalonQueueSnapshot } from '../services/salon.service';

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

// Used by the wall-QR landing page. Unknown and malformed codes get the same answer.
export async function getSalonByCode(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = salonCodeParamSchema.safeParse(req.params);
    const salon = parsed.success ? await getSalonByQrCode(parsed.data.code) : null;
    if (!salon) return res.status(404).json({ message: 'This QR code is not recognised.' });
    res.json({ salon });
  } catch (err) {
    next(err);
  }
}
