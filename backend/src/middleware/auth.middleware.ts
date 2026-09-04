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