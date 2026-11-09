// backend/src/controllers/team.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { broadcastQueueUpdate } from '../services/queue.service';
import {
  addStaffSchema,
  changePasswordSchema,
  resetStaffPasswordSchema,
  setStaffActiveSchema,
  staffIdParamSchema,
} from '../validators/barber.validators';
import {
  listTeam,
  addBarber,
  resetBarberPassword,
  setBarberActive,
  getStaffMe,
  changeOwnPassword,
} from '../services/team.service';

function staffOf(req: Request) {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return req.staff;
}

// Open to every signed-in staff member: the app uses it to decide which screens to show.
export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const me = await getStaffMe(staffOf(req).staffId);
    if (!me) throw new AppError('Session expired. Please log in again.', 401);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ staff: me });
  } catch (err) {
    next(err);
  }
}

// Everything below is mounted behind requireOwner.
export async function getTeam(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ team: await listTeam(staffOf(req).salonId) });
  } catch (err) {
    next(err);
  }
}

export async function postTeamMember(req: Request, res: Response, next: NextFunction) {
  try {
    const body = addStaffSchema.parse(req.body);
    res.status(201).json({ member: await addBarber(staffOf(req).salonId, body) });
  } catch (err) {
    next(err);
  }
}

export async function postTeamMemberPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { staffId } = staffIdParamSchema.parse(req.params);
    const { password } = resetStaffPasswordSchema.parse(req.body);
    await resetBarberPassword(staffOf(req).salonId, staffId, password);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function patchTeamMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { staffId } = staffIdParamSchema.parse(req.params);
    const { isActive } = setStaffActiveSchema.parse(req.body);
    const salonId = staffOf(req).salonId;
    const { moved, ...member } = await setBarberActive(salonId, staffId, isActive);
    // Moved customers need their ticket pages (new barber, new place) and notifications refreshed.
    if (moved > 0) await broadcastQueueUpdate(salonId).catch(() => {});
    res.json({ member, moved });
  } catch (err) {
    next(err);
  }
}

// Open to every signed-in staff member, for their own account only.
export async function postChangePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await changeOwnPassword(staffOf(req).staffId, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

