// backend/src/controllers/staffPush.controller.ts
// Barber "New token" alerts: turn on / off for this device, and send a test.
// Who and which salon always come from the verified session, never the body.
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { resolveScope } from '../services/barberScope.service';
import { staffPushBodySchema, staffPushDeleteSchema } from '../validators/staffPush.validators';
import {
  saveStaffSubscription,
  removeStaffSubscription,
  sendStaffTestPush,
} from '../services/staffPush.service';

async function whoIs(req: Request) {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  const scope = await resolveScope(req.staff, undefined);
  return { staffId: scope.staffId, salonId: scope.salonId };
}

export async function putStaffPush(req: Request, res: Response, next: NextFunction) {
  try {
    const who = await whoIs(req);
    const { subscription } = staffPushBodySchema.parse(req.body ?? {});
    await saveStaffSubscription(who, subscription);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function deleteStaffPush(req: Request, res: Response, next: NextFunction) {
  try {
    const who = await whoIs(req);
    const { endpoint } = staffPushDeleteSchema.parse(req.body ?? {});
    await removeStaffSubscription(who.staffId, endpoint);
    res.json({ ok: true }); // nothing to remove is still "off"
  } catch (err) {
    next(err);
  }
}

const TEST_ERRORS = {
  PUSH_DISABLED: { status: 409, message: 'Notifications are not available right now.' },
  NO_SUBSCRIPTION: { status: 409, message: 'Alerts are not turned on for this phone.' },
  TOO_SOON: { status: 429, message: 'Please wait a little before sending another test.' },
  FAILED: { status: 502, message: 'The test could not be sent. Please turn alerts off and on again.' },
} as const;

export async function postStaffPushTest(req: Request, res: Response, next: NextFunction) {
  try {
    const who = await whoIs(req);
    const result = await sendStaffTestPush(who.staffId);
    if (result.ok) return res.json({ ok: true, sent: result.sent });
    const e = TEST_ERRORS[result.reason];
    res.status(e.status).json({ message: e.message, code: result.reason });
  } catch (err) {
    next(err);
  }
}
