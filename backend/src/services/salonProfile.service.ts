// backend/src/services/salonProfile.service.ts
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import type { UpdateSalonProfileBody } from '../validators/salonProfile.validators';

const COLUMNS =
  'id, name, qr_code, phone, address, opening_time, closing_time, average_service_minutes, allow_app_join';

interface SalonRow {
  id: string;
  name: string;
  qr_code: string;
  phone: string;
  address: string;
  opening_time: string;
  closing_time: string;
  average_service_minutes: number;
  allow_app_join: boolean;
}

// Superset of what GET /api/barber/salon already returned (id, name, qrCode).
function toProfile(r: SalonRow) {
  return {
    id: r.id,
    name: r.name,
    qrCode: r.qr_code,
    phone: r.phone,
    address: r.address,
    openingTime: r.opening_time.slice(0, 5), // tolerate "09:00:00"
    closingTime: r.closing_time.slice(0, 5),
    averageServiceMinutes: r.average_service_minutes,
    allowAppJoin: r.allow_app_join, // customers can take a token from the app (from home)
  };
}

export async function getSalonProfile(salonId: string) {
  const { data, error } = await supabase.from('salons').select(COLUMNS).eq('id', salonId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Salon not found.', 404);
  return toProfile(data as SalonRow);
}

export async function updateSalonProfile(salonId: string, patch: UpdateSalonProfileBody) {
  // Hours are only compared when the request touches them, so renaming the
  // salon never fails because of old data.
  if (patch.openingTime !== undefined || patch.closingTime !== undefined) {
    const current = await getSalonProfile(salonId);
    const opening = patch.openingTime ?? current.openingTime;
    const closing = patch.closingTime ?? current.closingTime;
    if (opening >= closing) {
      throw new AppError('Closing time must be after opening time.', 400);
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.address !== undefined) update.address = patch.address;
  if (patch.openingTime !== undefined) update.opening_time = patch.openingTime;
  if (patch.closingTime !== undefined) update.closing_time = patch.closingTime;
  if (patch.averageServiceMinutes !== undefined) {
    update.average_service_minutes = patch.averageServiceMinutes;
  }
  if (patch.allowAppJoin !== undefined) update.allow_app_join = patch.allowAppJoin;

  const { data, error } = await supabase
    .from('salons')
    .update(update)
    .eq('id', salonId) // always the session's salon, never from the body
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('Salon not found.', 404);
  return toProfile(data as SalonRow);
}