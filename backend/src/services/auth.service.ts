// backend/src/services/auth.service.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import type { JwtPayload, RefreshPayload, StaffRole } from '../types/auth.types';
import type { RegisterSalonBody } from '../validators/auth.validators';
import { assignPlaceToSalon } from './place.service';
import { normalizePhone } from '../utils/phone';
import { SALON_SUSPENDED_STAFF } from '../utils/suspension';
import { tokenIssuedBeforeCutoff } from './sessionState.service';
import { recordAuthEvent } from './events.service';

// The embedded salon row can come back as an object or a one-item array depending on the client's typing.
function salonSuspended(salons: unknown): boolean {
  const s = (Array.isArray(salons) ? salons[0] : salons) as { is_suspended?: boolean } | null | undefined;
  return !!s?.is_suspended;
}
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

interface SalonStaffRow {
  id: string;
  salon_id: string;
  name: string;
  email: string | null;
  password_hash: string;
  role: StaffRole;
  is_active: boolean;
  salons: unknown; // embedded { is_suspended }
}

const BAD_LOGIN = 'Invalid email, phone number or password.';

// identifier is an email (contains "@") or a phone number.
export async function loginBarber(identifier: string, password: string) {
  const select = supabase
    .from('salon_staff')
    .select('id, salon_id, name, email, password_hash, role, is_active, salons(is_suspended)');

  let lookup;
  if (identifier.includes('@')) {
    lookup = select.eq('email', identifier.toLowerCase());
  } else {
    const phone = normalizePhone(identifier);
    if (!phone) throw new AppError(BAD_LOGIN, 401);
    lookup = select.eq('phone', phone);
  }
  const { data, error } = await lookup.maybeSingle<SalonStaffRow>();

  // Same message for "no such account" and "wrong password": no account enumeration.
  if (error || !data) throw new AppError(BAD_LOGIN, 401);

  const passwordMatches = await bcrypt.compare(password, data.password_hash);
  if (!passwordMatches) throw new AppError(BAD_LOGIN, 401);

  // Checked only after the password, so this message cannot be used to probe for accounts.
  if (!data.is_active) {
    throw new AppError('This account has been switched off. Please contact your salon owner.', 403);
  }
  // Also only after the password: a suspended salon's staff learn why they can't get in.
  if (salonSuspended(data.salons)) {
    throw new AppError(SALON_SUSPENDED_STAFF, 403);
  }

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
  } catch (err) {
    // Admin Slice 8: say WHY in the Tech tab. decode() is only used to name the account, never to trust it.
    const name = err instanceof Error ? err.name : '';
    const code =
      name === 'TokenExpiredError' ? 'REFRESH_EXPIRED'
      : err instanceof Error && err.message === 'missing jti' ? 'REFRESH_OLD_FORMAT'
      : 'REFRESH_INVALID';
    const decoded = jwt.decode(refreshToken) as { staffId?: string } | null;
    void recordAuthEvent(code, decoded?.staffId);
    throw new AppError(SESSION_ENDED, 401);
  }

  const { data: staff, error: staffError } = await supabase
    .from('salon_staff')
    .select('id, salon_id, role, is_active, sessions_valid_after, salons(is_suspended)')
    .eq('id', payload.staffId)
    .maybeSingle();
  if (staffError) throw staffError; // infrastructure problem: 500, not a forced logout
  if (!staff || !staff.is_active) {
    // removed or switched-off staff end here
    void recordAuthEvent(staff ? 'STAFF_INACTIVE' : 'STAFF_NOT_FOUND', payload.staffId);
    throw new AppError(SESSION_ENDED, 401);
  }
  // Admin Slice 2: a suspended salon, or a founder password reset after this token was issued, ends the session.
  if (salonSuspended(staff.salons)) {
    void recordAuthEvent('SALON_SUSPENDED', payload.staffId);
    throw new AppError(SALON_SUSPENDED_STAFF, 401);
  }
  const cutoff = staff.sessions_valid_after ? Date.parse(staff.sessions_valid_after as string) : null;
  if (tokenIssuedBeforeCutoff((payload as { iat?: number }).iat, cutoff)) {
    void recordAuthEvent('PASSWORD_RESET', payload.staffId);
    throw new AppError(SESSION_ENDED, 401);
  }

  const { error: claimError } = await supabase
    .from('revoked_tokens')
    .insert({ jti: payload.jti, expires_at: new Date(payload.exp * 1000).toISOString() });
  if (claimError) {
    if (claimError.code === '23505') {
      // already used or revoked: two refreshes racing, a replayed cookie, or a token from before logout
      void recordAuthEvent('REFRESH_REUSED', payload.staffId);
      throw new AppError(SESSION_ENDED, 401);
    }
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
    if (input.district || input.state) {
    try {
      await assignPlaceToSalon(row.o_salon_id, { district: input.district, state: input.state });
    } catch {
      console.error('[auth] could not assign a place to the new salon');
    }
  }

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
