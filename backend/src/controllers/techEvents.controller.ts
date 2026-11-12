// backend/src/controllers/techEvents.controller.ts
// Behind requireAuth + requireAdminRole('TECH') — FOUNDER always passes.
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getEventSummary } from '../services/events.service';

const querySchema = z.object({ days: z.enum(['1', '7']).default('1') });

export async function getEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const { days } = querySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getEventSummary(days === '7' ? 7 : 1));
  } catch (err) {
    next(err);
  }
}
