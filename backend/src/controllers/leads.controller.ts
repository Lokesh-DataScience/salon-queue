// backend/src/controllers/leads.controller.ts
// Behind requireAuth + requireAdminRole('SALES') — FOUNDER always passes.
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { adminRoleOf } from '../middleware/admin.middleware';
import { createLeadBodySchema, leadIdParamSchema, updateLeadBodySchema } from '../validators/admin.validators';
import { createLead, deleteLead, listLeads, updateLead } from '../services/leads.service';
import type { Actor } from '../services/founderSalons.service';

function actorOf(req: Request, res: Response): Actor {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return { staffId: req.staff.staffId, salonId: req.staff.salonId, role: adminRoleOf(res) };
}

export async function getLeads(_req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await listLeads());
  } catch (err) {
    next(err);
  }
}

export async function postLead(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createLeadBodySchema.parse(req.body);
    res.status(201).json({ lead: await createLead(actorOf(req, res), body) });
  } catch (err) {
    next(err);
  }
}

export async function patchLead(req: Request, res: Response, next: NextFunction) {
  try {
    const { leadId } = leadIdParamSchema.parse(req.params);
    const body = updateLeadBodySchema.parse(req.body);
    res.json({ lead: await updateLead(actorOf(req, res), leadId, body) });
  } catch (err) {
    next(err);
  }
}

export async function removeLead(req: Request, res: Response, next: NextFunction) {
  try {
    const { leadId } = leadIdParamSchema.parse(req.params);
    await deleteLead(actorOf(req, res), leadId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
