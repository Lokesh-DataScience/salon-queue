// backend/src/controllers/sales.controller.ts
// Behind requireAuth + requireAdminRole('SALES') — FOUNDER always passes.
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { adminRoleOf } from '../middleware/admin.middleware';
import { adminSalonIdParamSchema, salesInfoBodySchema } from '../validators/admin.validators';
import { getSalesActivity, updateSalesInfo } from '../services/sales.service';

export async function getActivity(_req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getSalesActivity());
  } catch (err) {
    next(err);
  }
}

export async function patchSalesInfo(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.staff) throw new AppError('Not authenticated.', 401);
    const { salonId } = adminSalonIdParamSchema.parse(req.params);
    const patch = salesInfoBodySchema.parse(req.body);
    const actor = { staffId: req.staff.staffId, salonId: req.staff.salonId, role: adminRoleOf(res) };
    res.json({ info: await updateSalesInfo(actor, salonId, patch) });
  } catch (err) {
    next(err);
  }
}
