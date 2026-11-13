// backend/src/services/salonServices.service.ts
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';

const MAX_SERVICES_PER_SALON = 30;
const COLUMNS = 'id, name, duration_minutes, price_rupees';
const DUPLICATE_MSG = 'You already have a service with that name.';

interface ServiceRow {
  id: string;
  name: string;
  duration_minutes: number;
  price_rupees: number | null;
}

const toDto = (r: ServiceRow) => ({
  id: r.id,
  name: r.name,
  durationMinutes: r.duration_minutes,
  priceRupees: r.price_rupees ?? null, // null = no price set
});

const isUniqueViolation = (e: { code?: string } | null) => e?.code === '23505';

export async function listServices(salonId: string) {
  const { data, error } = await supabase
    .from('salon_services')
    .select(COLUMNS)
    .eq('salon_id', salonId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as ServiceRow[]).map(toDto);
}

export async function createService(
  salonId: string,
  input: { name: string; durationMinutes: number; priceRupees?: number | null },
) {
  const { count, error: countError } = await supabase
    .from('salon_services')
    .select('id', { count: 'exact', head: true })
    .eq('salon_id', salonId)
    .is('deleted_at', null);

  if (countError) throw countError;
  if ((count ?? 0) >= MAX_SERVICES_PER_SALON) {
    throw new AppError(`You can have at most ${MAX_SERVICES_PER_SALON} services.`, 409);
  }

  const { data, error } = await supabase
    .from('salon_services')
    .insert({
      salon_id: salonId,
      name: input.name,
      duration_minutes: input.durationMinutes,
      price_rupees: input.priceRupees ?? null,
    })
    .select(COLUMNS)
    .single();

  if (isUniqueViolation(error)) throw new AppError(DUPLICATE_MSG, 409);
  if (error) throw error;
  return toDto(data as ServiceRow);
}

export async function updateService(
  salonId: string,
  serviceId: string,
  input: { name?: string; durationMinutes?: number; priceRupees?: number | null },
) {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.durationMinutes !== undefined) updates.duration_minutes = input.durationMinutes;
  if (input.priceRupees !== undefined) updates.price_rupees = input.priceRupees; // null clears it

  const { data, error } = await supabase
    .from('salon_services')
    .update(updates)
    .eq('id', serviceId)
    .eq('salon_id', salonId) // ownership: always the session's salon
    .is('deleted_at', null)
    .select(COLUMNS)
    .maybeSingle();

  if (isUniqueViolation(error)) throw new AppError(DUPLICATE_MSG, 409);
  if (error) throw error;
  if (!data) throw new AppError('Service not found.', 404);
  return toDto(data as ServiceRow);
}

export async function deleteService(salonId: string, serviceId: string) {
  const { data, error } = await supabase
    .from('salon_services')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', serviceId)
    .eq('salon_id', salonId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('Service not found.', 404);
}