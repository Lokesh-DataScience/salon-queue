// backend/src/controllers/tech.controller.ts
// Behind requireAuth + requireAdminRole('TECH') — FOUNDER always passes.
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getTechHealth } from '../services/techHealth.service';
import { getGitHistory } from '../services/gitHistory.service';

export async function getHealth(_req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getTechHealth());
  } catch (err) {
    next(err);
  }
}

// Code history: recent GitHub commits and which one is live.
const commitsQuerySchema = z.object({ refresh: z.enum(['1']).optional() });

export async function getCommits(req: Request, res: Response, next: NextFunction) {
  try {
    const { refresh } = commitsQuerySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getGitHistory({ refresh: refresh === '1' }));
  } catch (err) {
    next(err);
  }
}
