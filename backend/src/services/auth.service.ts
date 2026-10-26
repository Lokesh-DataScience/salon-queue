// backend/src/services/auth.service.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import type { JwtPayload, RefreshPayload, StaffRole } from '../types/auth.types';
import type { RegisterSalonBody } from '../validators/auth.validators';

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

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

  // Same message for "no such email" and "wrong password": no account enumeration.
  if (error || !data) throw new AppError('Invalid email or password.', 401);

  const passwordMatches = await bcrypt.compare(password, data.password_hash);
  if (!passwordMatches) throw new AppError('Invalid email or password.', 401);

  return {
    tokens: signTokens({ staffId: data.id, salonId: data.salon_id, role: data.role }),
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
  const claims = { staffId: payload.staffId, salonId: payload.salonId, role: payload.role };
  const accessToken = jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS });
  const refreshToken = jwt.sign(claims, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    jwtid: randomUUID(), // unique id so this one token can be revoked
  });
  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): RefreshPayload {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshPayload;
  if (typeof payload.jti !== 'string') throw new Error('missing jti'); // pre-6b tokens: re-login once
  return payload;
}

const SESSION_ENDED = 'Session expired. Please log in again.';

// Rotation: every refresh token works exactly once.
// 1. Signature and expiry are valid.
// 2. The staff row still exists, so a deleted or role-changed account is picked up here.
// 3. Atomically claim the jti. A replay or a simultaneous second request fails on the
//    primary key. Only then are new tokens issued.
export async function rotateRefreshToken(refreshToken: string) {
  let payload: RefreshPayload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(SESSION_ENDED, 401);
  }

  const { data: staff, error: staffError } = await supabase
    .from('salon_staff')
    .select('id, salon_id, role')
    .eq('id', payload.staffId)
    .maybeSingle();
  if (staffError) throw staffError; // infrastructure problem: 500, not a forced logout
  if (!staff) throw new AppError(SESSION_ENDED, 401);

  const { error: claimError } = await supabase
    .from('revoked_tokens')
    .insert({ jti: payload.jti, expires_at: new Date(payload.exp * 1000).toISOString() });
  if (claimError) {
    if (claimError.code === '23505') throw new AppError(SESSION_ENDED, 401); // already used or revoked
    throw claimError;
  }

  return signTokens({ staffId: staff.id, salonId: staff.salon_id, role: staff.role });
}

// Best effort: logout must always succeed for the user, even if this fails.
export async function revokeRefreshToken(refreshToken: string | undefined) {
  if (!refreshToken) return;
  try {
    const payload = verifyRefreshToken(refreshToken);
    const { error } = await supabase
      .from('revoked_tokens')
      .insert({ jti: payload.jti, expires_at: new Date(payload.exp * 1000).toISOString() });
    if (error && error.code !== '23505') console.error(`[auth] revoke failed: ${error.code ?? 'unknown'}`);
  } catch {
    // invalid or expired token: nothing to revoke
  }
}

export async function registerSalon(input: RegisterSalonBody) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  const { data, error } = await supabase.rpc('register_salon', {
    p_name: input.salonName,
    p_phone: input.phone,
    p_address: input.address,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_opening: input.openingTime,
    p_closing: input.closingTime,
    p_avg: input.averageServiceMinutes,
    p_owner_name: input.ownerName,
    p_email: input.email,
    p_password_hash: passwordHash,
  });

  if (error) {
    if (error.message?.includes('EMAIL_TAKEN')) {
      throw new AppError('An account with this email already exists. Try signing in instead.', 409);
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('register_salon returned no row');

  return {
    tokens: signTokens({ staffId: row.o_staff_id, salonId: row.o_salon_id, role: 'OWNER' }),
    staff: {
      id: row.o_staff_id as string,
      name: input.ownerName,
      email: input.email,
      role: 'OWNER' as const,
      salonId: row.o_salon_id as string,
    },
  };
}