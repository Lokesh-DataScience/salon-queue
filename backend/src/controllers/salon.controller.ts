// backend/src/controllers/salon.controller.ts
import { Request, Response, NextFunction } from 'express';
import { nearbySalonsQuerySchema, salonIdParamSchema, salonCodeParamSchema } from '../validators/salon.validators';
import { findNearbySalons, getSalonById, getSalonByQrCode, getSalonQueueSnapshot, getPublicLanes, getPublicQueue } from '../services/salon.service';
import { SALON_SUSPENDED_PUBLIC } from '../utils/suspension';
import { listServices } from '../services/salonServices.service';

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

export async function getPublicServices(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = salonIdParamSchema.parse(req.params);
    res.json({ services: await listServices(salonId) });
  } catch (err) {
    next(err);
  }
}

// A salon with one barber returns one lane; the app only shows the barber choice for two or more.
export async function getSalonLanes(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = salonIdParamSchema.parse(req.params);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ lanes: await getPublicLanes(salonId) });
  } catch (err) {
    next(err);
  }
}

// Customer app: one salon's live queue, and whether a token can be taken from the app.
export async function getSalonPublicQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = salonIdParamSchema.parse(req.params);
    const result = await getPublicQueue(salonId);
    if (!result) return res.status(404).json({ message: 'Salon not found.' });
    if ('suspended' in result) {
      return res.status(409).json({ message: SALON_SUSPENDED_PUBLIC, code: 'SALON_SUSPENDED' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    next(err);
  }
}
