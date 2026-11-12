// backend/src/controllers/founderSalons.controller.ts
// All routes sit behind requireAuth + requireAdminRole('FOUNDER') (on the founder sub-router).
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { adminRoleOf } from '../middleware/admin.middleware';
import { registerSalonBodySchema } from '../validators/auth.validators';
import {
  adminResetPasswordBodySchema,
  adminSalonIdParamSchema,
  adminSalonListQuerySchema,
  adminStaffIdParamSchema,
  deleteSalonBodySchema,
  internalBodySchema,
  suspendBodySchema,
} from '../validators/admin.validators';
import {
  createSalon,
  deleteSalon,
  getSalon,
  listSalons,
  resetStaffPassword,
  setInternal,
  setSuspended,
  type Actor,
} from '../services/founderSalons.service';

function actorOf(req: Request, res: Response): Actor {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return { staffId: req.staff.staffId, salonId: req.staff.salonId, role: adminRoleOf(res) };
}

export async function getSalons(req: Request, res: Response, next: NextFunction) {
  try {
    const { search } = adminSalonListQuerySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ salons: await listSalons(search) });
  } catch (err) {
    next(err);
  }
}

export async function getSalonDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = adminSalonIdParamSchema.parse(req.params);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ salon: await getSalon(salonId) });
  } catch (err) {
    next(err);
  }
}

export async function postSalon(req: Request, res: Response, next: NextFunction) {
  try {
    // isInternal is ours; everything else is validated exactly like the public sign-up.
    const { isInternal, ...rest } = (req.body ?? {}) as Record<string, unknown>;
    const body = registerSalonBodySchema.parse(rest);
    const result = await createSalon(actorOf(req, res), body, isInternal === true);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function postSuspension(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = adminSalonIdParamSchema.parse(req.params);
    const { suspended } = suspendBodySchema.parse(req.body);
    res.json({ salon: await setSuspended(actorOf(req, res), salonId, suspended) });
  } catch (err) {
    next(err);
  }
}

export async function postInternal(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = adminSalonIdParamSchema.parse(req.params);
    const { isInternal } = internalBodySchema.parse(req.body);
    res.json({ salon: await setInternal(actorOf(req, res), salonId, isInternal) });
  } catch (err) {
    next(err);
  }
}

export async function postStaffPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { staffId } = adminStaffIdParamSchema.parse(req.params);
    const { founderPassword, newPassword } = adminResetPasswordBodySchema.parse(req.body);
    await resetStaffPassword(actorOf(req, res), staffId, founderPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function removeSalon(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = adminSalonIdParamSchema.parse(req.params);
    const { confirmName } = deleteSalonBodySchema.parse(req.body);
    await deleteSalon(actorOf(req, res), salonId, confirmName);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
