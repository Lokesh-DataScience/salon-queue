// backend/src/controllers/bugReports.controller.ts
// Barber side: /api/barber/bug-reports (any signed-in staff).
// Tech side:   /api/admin/tech/bugs (TECH or FOUNDER).
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { adminRoleOf } from '../middleware/admin.middleware';
import {
  bugIdParamSchema,
  bugListQuerySchema,
  bugReportBodySchema,
  bugUpdateBodySchema,
} from '../validators/admin.validators';
import { createBugReport, listBugReports, listMyBugReports, updateBugReport } from '../services/bugReports.service';

function staffOf(req: Request) {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return req.staff;
}

export async function postBugReport(req: Request, res: Response, next: NextFunction) {
  try {
    const body = bugReportBodySchema.parse(req.body);
    res.status(201).json({ report: await createBugReport(staffOf(req), body) });
  } catch (err) {
    next(err);
  }
}

export async function getMyBugReports(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ reports: await listMyBugReports(staffOf(req).staffId) });
  } catch (err) {
    next(err);
  }
}

export async function getBugs(req: Request, res: Response, next: NextFunction) {
  try {
    const { status } = bugListQuerySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ reports: await listBugReports(status) });
  } catch (err) {
    next(err);
  }
}

export async function patchBug(req: Request, res: Response, next: NextFunction) {
  try {
    const s = staffOf(req);
    const { bugId } = bugIdParamSchema.parse(req.params);
    const patch = bugUpdateBodySchema.parse(req.body);
    res.json({ report: await updateBugReport({ staffId: s.staffId, salonId: s.salonId, role: adminRoleOf(res) }, bugId, patch) });
  } catch (err) {
    next(err);
  }
}
