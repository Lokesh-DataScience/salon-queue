// backend/src/middleware/auth.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth.service';
import { getSessionState, tokenIssuedBeforeCutoff } from '../services/sessionState.service';
import { SALON_SUSPENDED_STAFF } from '../utils/suspension';
import { AppError } from './errorHandler';
import type { JwtPayload } from '../types/auth.types';

// Verifies the access-token cookie and attaches req.staff. Does NOT check
// salon ownership — that's a separate, route-specific concern (see
// ownership.middleware.ts in Milestone 3b), since "own this salon" only
// makes sense once we know *which* salon a request is about.
//
// Admin Slice 2: also checks (cached ~30s, cleared by founder actions) that the account still
// exists, its salon is not suspended, and the token is newer than a founder password reset.
// All three end in 401, so the app's normal "session ended" handling sends them to the login page,
// where the real reason is shown.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.access_token;

  if (!token) {
    return next(new AppError('Not authenticated.', 401));
  }

  let payload: JwtPayload & { iat?: number };
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(new AppError('Session expired or invalid. Please log in again.', 401));
  }

  try {
    const state = await getSessionState(payload.staffId);
    if (!state) return next(new AppError('Session expired. Please log in again.', 401));
    if (state.salonSuspended) return next(new AppError(SALON_SUSPENDED_STAFF, 401));
    if (tokenIssuedBeforeCutoff(payload.iat, state.sessionsValidAfterMs)) {
      return next(new AppError('Session expired. Please log in again.', 401));
    }
    req.staff = payload;
    next();
  } catch (err) {
    next(err);
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
