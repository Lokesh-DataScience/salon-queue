// backend/src/middleware/shopSecurity.middleware.ts
// Commerce request-forgery protection (COMMERCE_PHASE1_PLAN_FINAL.md §9.3, D23). Applied to every
// state-changing request under /api/admin/shop (and, from C4, /api/shop):
//   1. Origin must exactly equal the app's origin; if Origin is absent, Referer must start with it;
//      if both are absent → 403.
//   2. Sec-Fetch-Site, when sent, must be "same-origin" ("same-site" is also allowed outside production,
//      because Vite on :5173 calls the API on :4000 in local development).
//   3. A CSRF token in a header, verified with a constant-time comparison.
//   4. JSON bodies only (image uploads: the image content types only).
// The rest of the app (queue, barber, other admin pages) is unchanged.
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { AppError } from './errorHandler';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FORBIDDEN = 'This request was blocked for your security. Refresh the page and try again.';

export const ADMIN_CSRF_HEADER = 'x-admin-csrf';
export const ADMIN_CSRF_TTL_MS = 12 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60_000;

export function appOrigin(): string {
  return new URL(env.FRONTEND_URL).origin;
}

// A separate key per purpose, derived from the existing secret (no new env variable needed).
function csrfKey(purpose: 'admin' | 'customer'): Buffer {
  return createHmac('sha256', env.JWT_SECRET).update(`shop-csrf-v1:${purpose}`).digest();
}

function mac(purpose: 'admin' | 'customer', subject: string, issuedAt: number): string {
  return createHmac('sha256', csrfKey(purpose)).update(`${subject}|${issuedAt}`).digest('base64url');
}

// Token = "<issuedAtMs>.<hmac(staffId|issuedAtMs)>". Kept in JS memory only by the frontend.
export function issueAdminCsrfToken(staffId: string, now = Date.now()) {
  return { csrfToken: `${now}.${mac('admin', staffId, now)}`, expiresAt: new Date(now + ADMIN_CSRF_TTL_MS).toISOString() };
}

export function verifyAdminCsrfToken(staffId: string, token: unknown, now = Date.now()): boolean {
  if (typeof token !== 'string' || token.length > 200) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const issuedAt = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(issuedAt)) return false;
  if (issuedAt > now + CLOCK_SKEW_MS || now - issuedAt > ADMIN_CSRF_TTL_MS) return false;
  const expected = Buffer.from(mac('admin', staffId, issuedAt));
  const given = Buffer.from(token.slice(dot + 1));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Rules 1 and 2.
export function requireSameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = appOrigin();

  const site = req.get('sec-fetch-site');
  if (site !== undefined) {
    const ok = site === 'same-origin' || (env.NODE_ENV !== 'production' && site === 'same-site');
    if (!ok) return next(new AppError(FORBIDDEN, 403));
  }

  const sentOrigin = req.get('origin');
  if (sentOrigin !== undefined) {
    if (sentOrigin !== origin) return next(new AppError(FORBIDDEN, 403));
    return next();
  }
  const referer = req.get('referer');
  if (referer !== undefined && (referer === origin || referer.startsWith(`${origin}/`))) return next();
  return next(new AppError(FORBIDDEN, 403));
}

// Rule 4. `allowed` lists the content types this route accepts (default: JSON only).
export function requireContentType(allowed: string[] = ['application/json']) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const type = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!allowed.includes(type)) return next(new AppError(FORBIDDEN, 403));
    next();
  };
}

// Rule 3, admin side. Placed after requireAuth (req.staff is set).
export function requireAdminCsrf(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const staffId = req.staff?.staffId;
  if (!staffId || !verifyAdminCsrfToken(staffId, req.get(ADMIN_CSRF_HEADER))) {
    return next(new AppError(FORBIDDEN, 403));
  }
  next();
}
