// backend/src/controllers/founderTeam.controller.ts
// Behind requireAuth + requireAdminRole('FOUNDER') (on the founder sub-router).
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { adminRoleOf } from '../middleware/admin.middleware';
import { adminStaffIdParamSchema, auditQuerySchema, grantAdminBodySchema } from '../validators/admin.validators';
import { grantAdmin, listAdmins, listAudit, revokeAdmin } from '../services/founderTeam.service';
import type { Actor } from '../services/founderSalons.service';

function actorOf(req: Request, res: Response): Actor {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return { staffId: req.staff.staffId, salonId: req.staff.salonId, role: adminRoleOf(res) };
}

export async function getTeam(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ admins: await listAdmins(actorOf(req, res)) });
  } catch (err) {
    next(err);
  }
}

export async function postTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const body = grantAdminBodySchema.parse(req.body);
    res.status(201).json(await grantAdmin(actorOf(req, res), body));
  } catch (err) {
    next(err);
  }
}

export async function deleteTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const { staffId } = adminStaffIdParamSchema.parse(req.params);
    await revokeAdmin(actorOf(req, res), staffId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function getAudit(req: Request, res: Response, next: NextFunction) {
  try {
    const q = auditQuerySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await listAudit(q));
  } catch (err) {
    next(err);
  }
}
