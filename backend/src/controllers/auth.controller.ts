// backend/src/controllers/auth.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { barberLoginBodySchema } from '../validators/auth.validators';
import { loginBarber, refreshAccessToken, verifyRefreshToken } from '../services/auth.service';
import { AppError } from '../middleware/errorHandler';

const isProd = env.NODE_ENV === 'production';

const ACCESS_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd,
  maxAge: 15 * 60 * 1000, // 15m, mirrors ACCESS_TOKEN_TTL
  path: '/',
};

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7d, mirrors REFRESH_TOKEN_TTL
  path: '/',
};

export async function postBarberLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = barberLoginBodySchema.parse(req.body);
    const { tokens, staff } = await loginBarber(email, password);

    res
      .cookie('access_token', tokens.accessToken, ACCESS_COOKIE_OPTS)
      .cookie('refresh_token', tokens.refreshToken, REFRESH_COOKIE_OPTS)
      .status(200)
      .json({ staff });
  } catch (err) {
    next(err);
  }
}

export async function postBarberRefresh(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) throw new AppError('Not authenticated.', 401);

    // Validate before re-signing so an expired/tampered refresh token
    // never results in a fresh access token being issued.
    verifyRefreshToken(refreshToken);
    const accessToken = refreshAccessToken(refreshToken);

    res.cookie('access_token', accessToken, ACCESS_COOKIE_OPTS).status(200).json({ ok: true });
  } catch {
    next(new AppError('Session expired. Please log in again.', 401));
  }
}

export async function postBarberLogout(_req: Request, res: Response) {
  res
    .clearCookie('access_token', { path: '/' })
    .clearCookie('refresh_token', { path: '/' })
    .status(200)
    .json({ ok: true });
}