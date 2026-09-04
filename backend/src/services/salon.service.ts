import { supabase } from '../config/supabase';

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
  const { data, error } = await supabase
    .from('salons')
    .select('*')
    .eq('id', salonId)
    .single();
  if (error) return null;
  return data;
}

export async function getSalonQueueSnapshot(salonId: string) {
  const { data: queue } = await supabase
    .from('queues')
    .select('*')
    .eq('salon_id', salonId)
    .eq('date', new Date().toISOString().slice(0, 10))
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