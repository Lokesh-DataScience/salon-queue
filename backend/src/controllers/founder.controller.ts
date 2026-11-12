// backend/src/controllers/founder.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { getFounderOverview } from '../services/founder.service';

// GET /api/admin/founder/overview — FOUNDER only (guard is on the founder sub-router).
export async function getOverview(_req: Request, res: Response, next: NextFunction) {
  try {
    const overview = await getFounderOverview();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ overview });
  } catch (err) {
    next(err);
  }
}
