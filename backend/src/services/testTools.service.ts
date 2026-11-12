// backend/src/services/testTools.service.ts
// Tech → Tools: act out real queue situations on INTERNAL salons only, using the same database
// functions the app uses. Every action is audit-logged. Never touches a real salon.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { todayISODate } from '../utils/date';
import { broadcastQueueUpdate } from './queue.service';
import { advanceSalonQueue } from './queueAutomation.service';
import { NotificationService } from './notification.service';
import { logAdminAction } from './admin.service';
import type { Actor } from './founderSalons.service';

export async function listTestSalons() {
  const { data, error } = await supabase
    .from('salons')
    .select('id, name, opening_time, closing_time, is_suspended')
    .eq('is_internal', true)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    hours: `${s.opening_time}–${s.closing_time}`,
    isSuspended: !!s.is_suspended,
  }));
}

async function internalSalon(salonId: string) {
  const { data, error } = await supabase.from('salons').select('id, name, is_internal').eq('id', salonId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Salon not found.', 404);
  if (!data.is_internal) throw new AppError('Testing tools only work on internal salons.', 409);
  return data as { id: string; name: string };
}

// Database errors from the join/walk-in functions, in plain words.
function friendly(err: unknown): never {
  const m = String((err as { message?: unknown })?.message ?? '');
  if (m.includes('LANE_')) throw new AppError("This salon's barber line isn't available.", 409);
  if (m.includes('SALON_SUSPENDED')) throw new AppError('This salon is suspended.', 409);
  if (m.includes('SALON_CLOSED')) throw new AppError('The salon is closed right now (check its opening hours in Settings).', 409);
  if (m.includes('QUEUE_NOT_ACTIVE')) throw new AppError('The queue is paused or switched off.', 409);
  throw err;
}

async function afterChange(salonId: string) {
  await advanceSalonQueue(salonId).catch(() => console.error(`[test-tools] advance failed salon=${salonId}`));
  await broadcastQueueUpdate(salonId);
}

async function todayQueueId(salonId: string) {
  const { data, error } = await supabase.from('queues').select('id').eq('salon_id', salonId).eq('date', todayISODate()).maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

const log = (actor: Actor, action: string, salon: { id: string; name: string }, extra: Record<string, unknown> = {}) =>
  logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: `tech.test_${action}`,
    targetType: 'salon',
    targetId: salon.id,
    details: { name: salon.name, ...extra },
  });

// Same database function a real QR scan uses. No customer details: the test ticket is anonymous.
export async function simulateScan(actor: Actor, salonId: string) {
  const salon = await internalSalon(salonId);
  const { data, error } = await supabase.rpc('join_queue', {
    p_salon_id: salonId,
    p_client_key: `admin-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    p_lane_id: null,
  });
  if (error) friendly(error);
  const row = (Array.isArray(data) ? data[0] : data) as { entry_id?: string; id?: string } | null;
  const entryId = row?.entry_id ?? row?.id;
  if (!entryId) throw new AppError('Could not add the test customer. Please try again.', 500);

  const { data: entry, error: eErr } = await supabase
    .from('queue_entries')
    .select('id, token_number, access_token')
    .eq('id', entryId)
    .single();
  if (eErr) throw eErr;
  await afterChange(salonId);
  await log(actor, 'scan', salon, { token: entry.token_number });
  // Internal test salon only: the link opens the test customer's ticket page.
  return {
    token: entry.token_number as number,
    ticketUrl: `/tickets/${entry.id}?accessToken=${entry.access_token}`,
  };
}

export async function simulateWalkIn(actor: Actor, salonId: string) {
  const salon = await internalSalon(salonId);
  const { data, error } = await supabase.rpc('add_walk_in', { p_salon_id: salonId, p_lane_id: null });
  if (error) friendly(error);
  const row = (Array.isArray(data) ? data[0] : data) as { entry_id?: string; token_number: number } | null;
  if (!row?.entry_id) throw new AppError('Could not add the walk-in. Please try again.', 500);
  await afterChange(salonId);
  await log(actor, 'walk_in', salon, { token: row.token_number });
  return { token: row.token_number };
}

// Ends the current service now (as if its time ran out), so the next customer starts.
export async function finishServiceNow(actor: Actor, salonId: string, token?: number) {
  const salon = await internalSalon(salonId);
  const queueId = await todayQueueId(salonId);
  if (!queueId) throw new AppError('No queue today yet.', 409);

  let q = supabase.from('queue_entries').select('id, token_number').eq('queue_id', queueId).eq('status', 'SERVING');
  if (token) q = q.eq('token_number', token);
  const { data: serving, error } = await q;
  if (error) throw error;
  if (!serving || serving.length === 0) {
    throw new AppError(token ? `Token #${token} is not being served.` : 'Nobody is being served right now.', 409);
  }

  const { error: uErr } = await supabase
    .from('queue_entries')
    .update({ ends_at: new Date(Date.now() - 1000).toISOString() })
    .in('id', serving.map((e) => e.id));
  if (uErr) throw uErr;
  await afterChange(salonId);
  const tokens = serving.map((e) => e.token_number as number);
  await log(actor, 'finish', salon, { tokens: tokens.join(',') });
  return { tokens };
}

export async function sendTestPush(actor: Actor, salonId: string, token: number) {
  const salon = await internalSalon(salonId);
  const queueId = await todayQueueId(salonId);
  if (!queueId) throw new AppError('No queue today yet.', 409);
  const { data: entry, error } = await supabase
    .from('queue_entries')
    .select('id, token_number, push_subscription')
    .eq('queue_id', queueId)
    .eq('token_number', token)
    .maybeSingle();
  if (error) throw error;
  if (!entry) throw new AppError(`No token #${token} today.`, 404);
  if (!entry.push_subscription) throw new AppError(`Token #${token} hasn't turned notifications on.`, 409);

  await NotificationService.notifyTurnNow({ entryId: entry.id as string, salonId, tokenNumber: token });
  await log(actor, 'push', salon, { token });
  return { token };
}

export async function clearToday(actor: Actor, salonId: string) {
  const salon = await internalSalon(salonId);
  const queueId = await todayQueueId(salonId);
  if (!queueId) return { cancelled: 0 };
  const { data, error } = await supabase
    .from('queue_entries')
    .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
    .eq('queue_id', queueId)
    .in('status', ['WAITING', 'CALLED', 'SERVING'])
    .select('id');
  if (error) throw error;
  await broadcastQueueUpdate(salonId);
  await log(actor, 'clear', salon, { cancelled: (data ?? []).length });
  return { cancelled: (data ?? []).length };
}
