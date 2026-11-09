// backend/src/middleware/auth.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth.service';
import { AppError } from './errorHandler';

// Verifies the access-token cookie and attaches req.staff. Does NOT check
// salon ownership — that's a separate, route-specific concern (see
// ownership.middleware.ts in Milestone 3b), since "own this salon" only
// makes sense once we know *which* salon a request is about.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.access_token;

  if (!token) {
    return next(new AppError('Not authenticated.', 401));
  }

  try {
    req.staff = verifyAccessToken(token);
    next();
  } catch {
    next(new AppError('Session expired or invalid. Please log in again.', 401));
  }
}

// Salon settings, offers, stats and the team list are for the owner only. Staff accounts
// (role BARBER) can run the queue but nothing else. Always placed AFTER requireAuth.
// The role comes from the verified token, which is refreshed from the database on every
// token rotation, so a role change takes effect within one access-token lifetime.
export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (req.staff?.role !== 'OWNER') {
    return next(new AppError('Only the salon owner can do this.', 403));
  }
  next();
}