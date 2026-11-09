// backend/src/services/team.service.ts
import bcrypt from 'bcrypt';
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';

const MAX_BARBERS = 10;

interface TeamRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: 'OWNER' | 'BARBER' | 'MANAGER';
  is_active: boolean;
  lane_id: string | null;
}

const toDto = (r: TeamRow) => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  role: r.role,
  isActive: r.is_active,
  laneId: r.lane_id,
});

// Every function takes salonId from the verified session, never from the request.
export async function listTeam(salonId: string) {
  const { data, error } = await supabase
    .from('salon_staff')
    .select('id, name, phone, email, role, is_active, lane_id')
    .eq('salon_id', salonId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as TeamRow[]).map(toDto);
}

// Creates the barber and their lane together (one transaction in Postgres).
export async function addBarber(
  salonId: string,
  input: { name: string; phone: string; password: string },
) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  const { data, error } = await supabase.rpc('add_staff_with_lane', {
    p_salon_id: salonId,
    p_name: input.name,
    p_phone: input.phone,
    p_password_hash: passwordHash,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('PHONE_TAKEN')) throw new AppError('That phone number is already registered.', 409);
    if (msg.includes('TOO_MANY_BARBERS')) throw new AppError(`You can have at most ${MAX_BARBERS} barbers.`, 409);
    if (msg.includes('SALON_NOT_FOUND')) throw new AppError('Salon not found.', 404);
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.o_staff_id) throw new AppError('Could not add the barber. Please try again.', 500);

  return toDto({
    id: row.o_staff_id as string,
    name: input.name,
    phone: input.phone,
    email: null,
    role: 'BARBER',
    is_active: true,
    lane_id: row.o_lane_id as string,
  });
}

// The owner sets a new password for a barber who forgot theirs.
export async function resetBarberPassword(salonId: string, staffId: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from('salon_staff')
    .update({ password_hash: passwordHash })
    .eq('id', staffId)
    .eq('salon_id', salonId) // ownership: always the session's salon
    .neq('role', 'OWNER')
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('Barber not found.', 404);
}

// Switching a barber off moves their waiting customers to the shortest remaining line (one
// transaction in Postgres). A customer already called or being served finishes first.
export async function setBarberActive(salonId: string, staffId: string, isActive: boolean) {
  const { data, error } = await supabase.rpc('set_staff_active', {
    p_salon_id: salonId,
    p_staff_id: staffId,
    p_active: isActive,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('STAFF_NOT_FOUND')) throw new AppError('Barber not found.', 404);
    if (msg.includes('LANE_BUSY')) {
      throw new AppError(
        'This barber has a customer who is being called or served. Switch them off when that customer is done.',
        409,
      );
    }
    if (msg.includes('TOO_MANY_BARBERS')) throw new AppError(`You can have at most ${MAX_BARBERS} barbers.`, 409);
    throw error;
  }
  return { id: staffId, isActive, moved: typeof data === 'number' ? data : 0 };
}

// Who am I? Read from the database (not the token) so a switched-off account stops working
// on its very next page load instead of lingering until the token expires.
export async function getStaffMe(staffId: string) {
  const { data, error } = await supabase
    .from('salon_staff')
    .select('id, name, role, salon_id, lane_id, is_active, lanes(name)')
    .eq('id', staffId)
    .maybeSingle();

  if (error) throw error;
  if (!data || !data.is_active) return null;

  const lane = Array.isArray(data.lanes) ? data.lanes[0] : data.lanes;
  return {
    id: data.id as string,
    name: data.name as string,
    role: data.role as 'OWNER' | 'BARBER' | 'MANAGER',
    salonId: data.salon_id as string,
    laneId: (data.lane_id as string | null) ?? null,
    laneName: (lane as { name: string } | null | undefined)?.name ?? null,
  };
}

// Any signed-in staff member changes their own password. A wrong current password is a 400, not
// a 401: the app reads 401 as "your session ended" and would log the person out.
export async function changeOwnPassword(staffId: string, currentPassword: string, newPassword: string) {
  const { data, error } = await supabase
    .from('salon_staff')
    .select('id, password_hash, is_active')
    .eq('id', staffId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.is_active) throw new AppError('Session expired. Please log in again.', 401);

  const matches = await bcrypt.compare(currentPassword, data.password_hash as string);
  if (!matches) throw new AppError('Your current password is not correct.', 400);
  if (currentPassword === newPassword) throw new AppError('Choose a password you have not used before.', 400);

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const { error: updateError } = await supabase
    .from('salon_staff')
    .update({ password_hash: passwordHash })
    .eq('id', staffId);
  if (updateError) throw updateError;
}

