// backend/src/controllers/auth.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { barberLoginBodySchema, registerSalonBodySchema } from '../validators/auth.validators';
import {
  loginBarber,
  registerSalon,
  rotateRefreshToken,
  revokeRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../services/auth.service';
import { AppError } from '../middleware/errorHandler';

const isProd = env.NODE_ENV === 'production';

// The refresh cookie is only ever sent to the auth endpoints, never with ordinary API calls.
const REFRESH_PATH = '/api/auth/barber';

const BASE = { httpOnly: true, sameSite: 'lax' as const, secure: isProd };
const ACCESS_COOKIE_OPTS = { ...BASE, path: '/', maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000 };
const REFRESH_COOKIE_OPTS = { ...BASE, path: REFRESH_PATH, maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 };

function setSessionCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
  res
    .cookie('access_token', tokens.accessToken, ACCESS_COOKIE_OPTS)
    .cookie('refresh_token', tokens.refreshToken, REFRESH_COOKIE_OPTS)
    // Purge the old path "/" refresh cookie that pre-6b logins left behind.
    .clearCookie('refresh_token', { path: '/' });
}

export async function postBarberLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = barberLoginBodySchema.parse(req.body);
    const { tokens, staff } = await loginBarber(email, password);
    setSessionCookies(res, tokens);
    res.status(200).json({ staff });
  } catch (err) {
    next(err);
  }
}

export async function postBarberRefresh(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) throw new AppError('Not authenticated.', 401);

    const tokens = await rotateRefreshToken(refreshToken);
    setSessionCookies(res, tokens);
    res.status(200).json({ ok: true });
  } catch (err) {
    // On failure we deliberately do NOT clear cookies. If two tabs refresh at once, the loser
    // would otherwise wipe the winner's brand-new cookies.
    next(err);
  }
}

export async function postBarberLogout(req: Request, res: Response) {
  await revokeRefreshToken(req.cookies?.refresh_token);
  res
    .clearCookie('access_token', { path: '/' })
    .clearCookie('refresh_token', { path: REFRESH_PATH })
    .clearCookie('refresh_token', { path: '/' })
    .status(200)
    .json({ ok: true });
}

export async function postBarberRegister(req: Request, res: Response, next: NextFunction) {
  try {
    const body = registerSalonBodySchema.parse(req.body);
    const { tokens, staff } = await registerSalon(body);
    setSessionCookies(res, tokens); // signed in straight away
    res.status(201).json({ staff });
  } catch (err) {
    next(err);
  }
}