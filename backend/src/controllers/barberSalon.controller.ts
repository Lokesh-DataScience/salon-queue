// backend/src/controllers/barberSalon.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { getSalonQrForStaff } from '../services/salon.service';

// GET /api/barber/salon: the logged-in barber's own salon, with the code for the wall QR.
// The salon id comes from the verified session only; nothing in the request can change which salon is read.
export async function getBarberSalon(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.staff) throw new AppError('Not authenticated.', 401);
    const salon = await getSalonQrForStaff(req.staff.salonId);
    if (!salon) throw new AppError('Salon not found.', 404);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ salon });
  } catch (err) {
    next(err);
  }
}
