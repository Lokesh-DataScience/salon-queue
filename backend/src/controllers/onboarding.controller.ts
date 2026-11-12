// backend/src/controllers/onboarding.controller.ts
// Behind requireAuth + requireAdminRole('SALES') — FOUNDER always passes.
import type { Request, Response, NextFunction } from 'express';
import { onboardingQuerySchema } from '../validators/admin.validators';
import { getOnboarding } from '../services/onboarding.service';

export async function getOnboardingFunnel(req: Request, res: Response, next: NextFunction) {
  try {
    const { period } = onboardingQuerySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getOnboarding(period));
  } catch (err) {
    next(err);
  }
}
