// backend/src/services/salon.service.ts
import { supabase } from '../config/supabase';
import { todayISODate } from '../utils/date';
import { isWithinHours } from '../utils/hours';

export async function findNearbySalons(lat: number, lng: number, radiusKm: number) {
  const { data, error } = await supabase.rpc('nearby_salons', {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radiusKm,
  });
  if (error) throw error;
  return data;
}


export async function getSalonById(salonId: string) {
  const { data, error } = await supabase.from('salons').select('*').eq('id', salonId).single();
  if (error) return null;
  // The QR code is only for the salon's own dashboard, so it never goes out on this public route.
  const { qr_code: _qrCode, ...publicSalon } = data;
  // "Open" means switched on AND inside today's opening hours.
  return { ...publicSalon, is_open: data.is_open && isWithinHours(data.opening_time, data.closing_time) };
}

// What a scan of the wall QR needs: which salon, and its name. Nothing else.
export async function getSalonByQrCode(code: string) {
  const { data, error } = await supabase
    .from('salons')
    .select('id, name')
    .eq('qr_code', code.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id as string, name: data.name as string };
}

// For the barber dashboard. The caller passes the salon id from the verified session, never from the request.
export async function getSalonQrForStaff(salonId: string) {
  const { data, error } = await supabase
    .from('salons')
    .select('id, name, qr_code')
    .eq('id', salonId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id as string, name: data.name as string, qrCode: data.qr_code as string };
}

export async function getSalonQueueSnapshot(salonId: string) {
  const { data: queue } = await supabase
    .from('queues')
    .select('*')
    .eq('salon_id', salonId)
    .eq('date', todayISODate())
    .maybeSingle();

  if (!queue) {
    return { currentToken: 0, waitingCount: 0 };
  }

  const { count } = await supabase
    .from('queue_entries')
    .select('*', { count: 'exact', head: true })
    .eq('queue_id', queue.id)
    .eq('status', 'WAITING');

  return { currentToken: queue.current_token, waitingCount: count ?? 0 };
}
