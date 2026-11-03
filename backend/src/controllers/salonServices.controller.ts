// backend/src/controllers/salonServices.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { addServiceBodySchema, serviceIdParamSchema } from '../validators/salonServices.validators';
import { listSalonServices, addSalonService, removeSalonService } from '../services/salonServices.service';

function salonIdOf(req: Request): string {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return req.staff.salonId;
}

export async function getServices(req: Request, res: Response, next: NextFunction) {
  try {
    const services = await listSalonServices(salonIdOf(req));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ services });
  } catch (err) {
    next(err);
  }
}

export async function postService(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const { name } = addServiceBodySchema.parse(req.body);
    const service = await addSalonService(salonId, name);
    res.status(201).json({ service });
  } catch (err) {
    next(err);
  }
}

export async function deleteService(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const { serviceId } = serviceIdParamSchema.parse(req.params);
    await removeSalonService(salonId, serviceId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}