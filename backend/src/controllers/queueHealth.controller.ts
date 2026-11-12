// backend/src/controllers/queueHealth.controller.ts
// Behind requireAuth + requireAdminRole('TECH') — FOUNDER always passes. Read-only.
import type { Request, Response, NextFunction } from 'express';
import { adminSalonIdParamSchema, techSalonSearchSchema } from '../validators/admin.validators';
import { getQueueHealth, getSalonQueueReadOnly, searchSalonsForTech } from '../services/queueHealth.service';

export async function getQueueChecks(_req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getQueueHealth());
  } catch (err) {
    next(err);
  }
}

export async function getTechSalons(req: Request, res: Response, next: NextFunction) {
  try {
    const { search } = techSalonSearchSchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ salons: await searchSalonsForTech(search) });
  } catch (err) {
    next(err);
  }
}

export async function getTechSalonQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = adminSalonIdParamSchema.parse(req.params);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getSalonQueueReadOnly(salonId));
  } catch (err) {
    next(err);
  }
}
