// backend/src/controllers/testTools.controller.ts
// Tech → Tools & flags (TECH or FOUNDER), plus the barber app's flag read.
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { adminRoleOf } from '../middleware/admin.middleware';
import {
  flagKeyParamSchema,
  flagUpdateBodySchema,
  testPushBodySchema,
  testSalonParamSchema,
  testTokenBodySchema,
} from '../validators/admin.validators';
import {
  clearToday,
  finishServiceNow,
  listTestSalons,
  sendTestPush,
  simulateScan,
  simulateWalkIn,
} from '../services/testTools.service';
import { flagsForApp, listFlags, updateFlag } from '../services/flags.service';
import type { Actor } from '../services/founderSalons.service';

function actorOf(req: Request, res: Response): Actor {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return { staffId: req.staff.staffId, salonId: req.staff.salonId, role: adminRoleOf(res) };
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await fn(req, res));
  } catch (err) {
    next(err);
  }
};
const salonOf = (req: Request) => testSalonParamSchema.parse(req.params).salonId;

export const getTestSalons = wrap(async () => ({ salons: await listTestSalons() }));
export const postTestScan = wrap(async (req, res) => simulateScan(actorOf(req, res), salonOf(req)));
export const postTestWalkIn = wrap(async (req, res) => simulateWalkIn(actorOf(req, res), salonOf(req)));
export const postTestFinish = wrap(async (req, res) =>
  finishServiceNow(actorOf(req, res), salonOf(req), testTokenBodySchema.parse(req.body ?? {}).token),
);
export const postTestPush = wrap(async (req, res) =>
  sendTestPush(actorOf(req, res), salonOf(req), testPushBodySchema.parse(req.body).token),
);
export const postTestClear = wrap(async (req, res) => clearToday(actorOf(req, res), salonOf(req)));

export const getFlags = wrap(async () => ({ flags: await listFlags(true) }));
export const patchFlag = wrap(async (req, res) => {
  const { key } = flagKeyParamSchema.parse(req.params);
  await updateFlag(actorOf(req, res), key, flagUpdateBodySchema.parse(req.body));
  return { ok: true };
});

// GET /api/barber/flags — any signed-in barber.
export async function getBarberFlags(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ flags: await flagsForApp() });
  } catch (err) {
    next(err);
  }
}
