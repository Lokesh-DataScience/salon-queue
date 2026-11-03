// backend/src/services/salonServices.service.ts
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';

export const MAX_SERVICES = 12;

export interface SalonService {
  id: string;
  name: string;
}

export async function listSalonServices(salonId: string): Promise<SalonService[]> {
  const { data, error } = await supabase
    .from('salon_services')
    .select('id, name')
    .eq('salon_id', salonId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SalonService[];
}

export async function addSalonService(salonId: string, name: string): Promise<SalonService> {
  const existing = await listSalonServices(salonId);
  if (existing.length >= MAX_SERVICES) {
    throw new AppError(`You can add up to ${MAX_SERVICES} services.`, 409);
  }

  const { data, error } = await supabase
    .from('salon_services')
    .insert({ salon_id: salonId, name }) // salon always comes from the session
    .select('id, name')
    .single();

  if (error) {
    // Unique index: same name already active for this salon.
    if (error.code === '23505') throw new AppError(`"${name}" is already in your list.`, 409);
    throw error;
  }
  return data as SalonService;
}

export async function removeSalonService(salonId: string, serviceId: string): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('salon_services')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', serviceId)
    .eq('salon_id', salonId) // ownership: another salon's id simply matches nothing
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('Service not found.', 404);
}