// backend/src/controllers/tech.controller.ts
// Behind requireAuth + requireAdminRole('TECH') — FOUNDER always passes.
import type { Request, Response, NextFunction } from 'express';
import { getTechHealth } from '../services/techHealth.service';

export async function getHealth(_req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getTechHealth());
  } catch (err) {
    next(err);
  }
}
