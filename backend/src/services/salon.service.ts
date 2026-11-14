// backend/src/services/salon.service.ts
import { supabase } from '../config/supabase';
import { todayISODate } from '../utils/date';
import { isWithinHours, isOffDay } from '../utils/hours';
import { publicSalonInfo } from '../utils/salonInfo';
import { getRatingStats, publicRating } from './ratings.service';

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
  // "Open" means switched on, not a weekly off day, AND inside today's opening hours.
  // weekly_off_days (0 = Sunday ... 6 = Saturday) comes along in publicSalon, so a page can say why.
  const offDay = isOffDay(data.weekly_off_days);
  return {
    ...publicSalon,
    is_open: data.is_open && !offDay && isWithinHours(data.opening_time, data.closing_time),
    is_off_day: offDay,
  };
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

// The customer app's view of one salon: is it open, can I join from here, how long is the wait,
// and how to reach it (the salon's own address, business phone, hours and map location).
// About customers: counts and token numbers only. Never their names, phones, prizes or access tokens.
// Returns null for an unknown salon, and { suspended: true } for a salon the founder suspended.
export async function getPublicQueue(salonId: string) {
  const { data: salon, error } = await supabase
    .from('salons')
    .select(
      'id, name, is_open, is_queue_active, opening_time, closing_time, allow_app_join, is_suspended, address, phone, latitude, longitude, weekly_off_days',
    )
    .eq('id', salonId)
    .maybeSingle();
  if (error) throw error;
  if (!salon) return null;
  if (salon.is_suspended) return { suspended: true as const };

  const { data: queue } = await supabase
    .from('queues')
    .select('id, current_token, status')
    .eq('salon_id', salonId)
    .eq('date', todayISODate())
    .maybeSingle();

  let waitingCount = 0;
  if (queue) {
    const { count } = await supabase
      .from('queue_entries')
      .select('id', { count: 'exact', head: true })
      .eq('queue_id', queue.id)
      .eq('status', 'WAITING');
    waitingCount = count ?? 0;
  }

  const lanes = await getPublicLanes(salonId);
  // Stars from customers; shown only from 5 ratings. A ratings problem never hides the queue.
  const rating = await getRatingStats(salonId).then(publicRating, () => null);
  const open = lanes.filter((l) => !l.isPaused);
  // What a new customer joining "Any barber" would wait: the shortest line that is not on a break.
  const estimatedWaitMinutes = open.length ? Math.min(...open.map((l) => l.estimatedWaitMinutes)) : null;

  const offDay = isOffDay(salon.weekly_off_days as number[] | null);
  const isPaused = !salon.is_queue_active || queue?.status === 'PAUSED' || (lanes.length > 0 && open.length === 0);

  return {
    salon: {
      salonId: salon.id as string,
      name: salon.name as string,
      isOpen: salon.is_open && !offDay && isWithinHours(salon.opening_time, salon.closing_time),
      isOffDay: offDay, // closed today because of the weekly off, so the app can say "Weekly off"
      weeklyOffDays: [...((salon.weekly_off_days as number[] | null) ?? [])].sort((a, b) => a - b),
      isPaused,
      allowAppJoin: salon.allow_app_join as boolean,
      nowServingToken: (queue?.current_token as number | undefined) ?? 0,
      waitingCount,
      estimatedWaitMinutes,
      // Only when there is a choice of barber; a one-barber salon shows none.
      lanes: lanes.length > 1 ? lanes : null,
      ...publicSalonInfo(salon),
      rating, // { average, count } or null below 5 ratings
    },
  };
}

// The barber lines a customer can choose from (switched-off barbers are left out).
// Only what a customer needs: a name and how long a new customer would wait. No staff details.
export async function getPublicLanes(salonId: string) {
  const { data, error } = await supabase.rpc('lane_waits', { p_salon_id: salonId });
  if (error) throw error;
  return ((data ?? []) as Array<{
    lane_id: string;
    name: string;
    is_default: boolean;
    created_at: string;
    waiting_count: number;
    wait_minutes: number;
    is_paused: boolean;
  }>)
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.created_at.localeCompare(b.created_at))
    .map((l) => ({
      id: l.lane_id,
      name: l.name,
      waitingCount: l.waiting_count,
      estimatedWaitMinutes: l.wait_minutes,
      isPaused: l.is_paused, // on a break: shown, but not selectable
    }));
}