// backend/src/controllers/salonServices.controller.ts
import type { Request, Response, NextFunction } from 'express';
import {
  serviceIdParamSchema,
  createServiceSchema,
  updateServiceSchema,
} from '../validators/barber.validators';
import {
  listServices,
  createService,
  updateService,
  deleteService,
} from '../services/salonServices.service';
import { AppError } from '../middleware/errorHandler';

function salonIdOf(req: Request): string {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return req.staff.salonId;
}

export async function getServices(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ services: await listServices(salonIdOf(req)) });
  } catch (err) {
    next(err);
  }
}

export async function postService(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const body = createServiceSchema.parse(req.body);
    res.status(201).json({ service: await createService(salonId, body) });
  } catch (err) {
    next(err);
  }
}

export async function patchService(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const { serviceId } = serviceIdParamSchema.parse(req.params);
    const body = updateServiceSchema.parse(req.body);
    res.json({ service: await updateService(salonId, serviceId, body) });
  } catch (err) {
    next(err);
  }
}

export async function removeService(req: Request, res: Response, next: NextFunction) {
  try {
    const salonId = salonIdOf(req);
    const { serviceId } = serviceIdParamSchema.parse(req.params);
    await deleteService(salonId, serviceId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}