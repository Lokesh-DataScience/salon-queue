// backend/src/controllers/ratings.controller.ts
// Customer app polish, slice 5: star ratings.
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { ticketParamSchema, ticketAccessQuerySchema } from '../validators/queue.validators';
import { getMyRating, getRatingStats, MIN_PUBLIC_RATINGS, rateTicket } from '../services/ratings.service';

const starsSchema = z.object({ stars: z.number().int().min(1).max(5) });

const RATE_ERRORS = {
  NOT_COMPLETED: { status: 409, message: 'You can rate a visit once your service is complete.' },
  TOO_LATE: { status: 409, message: 'This visit can no longer be rated.' },
} as const;

// GET /api/queue-tickets/:ticketId/rating — token in the X-Ticket-Token header, like the ticket itself.
export async function getTicketRating(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = ticketParamSchema.parse(req.params);
    const { accessToken } = ticketAccessQuerySchema.parse({ accessToken: req.get('x-ticket-token') });
    const result = await getMyRating(ticketId, accessToken);
    if (!result) return res.status(404).json({ message: 'Ticket not found or access denied.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/queue-tickets/:ticketId/rating { accessToken, stars } — token in the body, never the URL.
export async function postTicketRating(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = ticketParamSchema.parse(req.params);
    const { accessToken } = ticketAccessQuerySchema.parse({ accessToken: req.body?.accessToken });
    const { stars } = starsSchema.parse({ stars: req.body?.stars });
    const result = await rateTicket(ticketId, accessToken, stars);
    if (result.ok) return res.json({ stars: result.stars });
    if (result.reason === 'NOT_FOUND') return res.status(404).json({ message: 'Ticket not found or access denied.' });
    const e = RATE_ERRORS[result.reason];
    res.status(e.status).json({ message: e.message, code: result.reason });
  } catch (err) {
    next(err);
  }
}

// GET /api/barber/rating — the owner always sees their own numbers, even below the public minimum.
export async function getOwnerRating(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.staff) throw new AppError('Not authenticated.', 401);
    const stats = await getRatingStats(req.staff.salonId); // the session's salon, never from the request
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...stats, minPublic: MIN_PUBLIC_RATINGS, publiclyVisible: stats.count >= MIN_PUBLIC_RATINGS });
  } catch (err) {
    next(err);
  }
}
