// backend/src/services/auth.service.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import type { JwtPayload, StaffRole } from '../types/auth.types';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

interface SalonStaffRow {
  id: string;
  salon_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: StaffRole;
}

export async function loginBarber(email: string, password: string) {
  const { data, error } = await supabase
    .from('salon_staff')
    .select('id, salon_id, name, email, password_hash, role')
    .eq('email', email)
    .maybeSingle<SalonStaffRow>();

  // Deliberately generic message for both "no such email" and "wrong
  // password" — never reveal which one it was (avoids account enumeration).
  if (error || !data) {
    throw new AppError('Invalid email or password.', 401);
  }

  const passwordMatches = await bcrypt.compare(password, data.password_hash);
  if (!passwordMatches) {
    throw new AppError('Invalid email or password.', 401);
  }

  const payload: JwtPayload = {
    staffId: data.id,
    salonId: data.salon_id,
    role: data.role,
  };

  return {
    tokens: signTokens(payload),
    staff: {
      id: data.id,
      name: data.name,
      email: data.email,
      role: data.role,
      salonId: data.salon_id,
    },
  };
}

export function signTokens(payload: JwtPayload) {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}

// Refresh only re-signs the access token from the refresh token's claims.
// We deliberately don't hit the DB here (MVP scope — see auth.controller.ts
// comment), but that also means a staff row deleted/role-changed after
// login won't be reflected until the refresh token itself expires (7d).
// Acceptable for MVP; flagged for Milestone 6 hardening.
export function refreshAccessToken(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);
  const accessToken = jwt.sign(
    { staffId: payload.staffId, salonId: payload.salonId, role: payload.role },
    env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
  return accessToken;
}