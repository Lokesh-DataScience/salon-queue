// backend/src/services/queue.service.ts
import { supabase } from '../config/supabase';
import { getIO } from '../sockets/io';
import { AppError } from '../middleware/errorHandler';
import { todayISODate } from '../utils/date';
import { evaluateNotifications } from './queueNotifications.service';
import { advanceQueue } from './queueAutomation.service';

export class QueueJoinError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
const JOIN_ERROR_MESSAGES: Record<string, string> = {
  SALON_NOT_FOUND: 'Salon not found.',
  SALON_CLOSED: 'Salon is currently closed.',
  QUEUE_NOT_ACTIVE: 'Queue is paused.',
  INVALID_SERVICES: 'One of the services you chose is no longer available. Please choose again.',
};

export async function joinQueue(salonId: string, clientKey?: string, serviceIds?: string[]) {
  const { data, error } = serviceIds?.length
    ? await supabase.rpc('join_queue_with_services', {
        p_salon_id: salonId,
        p_service_ids: serviceIds,
        p_client_key: clientKey ?? null,
      })
    : await supabase.rpc('join_queue', {
        p_salon_id: salonId,
        p_client_key: clientKey ?? null,
      });
  if (error) {
    const code = error.message?.split(':')[0]?.trim();
    if (code && JOIN_ERROR_MESSAGES[code]) {
      throw new QueueJoinError(code, JOIN_ERROR_MESSAGES[code]);
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ticketId: row.entry_id,
    salonId, // NEW — already known from the param, no extra query needed
    queueId: row.queue_id,
    tokenNumber: row.token_number,
    accessToken: row.access_token,
    status: row.status,
    joinedAt: row.joined_at,
  };
}

export async function getTicketStatus(ticketId: string, accessToken: string) {
  const { data: entry, error } = await supabase
    .from('queue_entries')
    .select('*, queues(current_token, salon_id, status)')
    .eq('id', ticketId)
    .eq('access_token', accessToken)
    .maybeSingle();

  if (error || !entry) return null;
    // Time is up: complete (and promote the next customer) now, instead of waiting for the sweeper.
  if (entry.status === 'SERVING' && entry.ends_at && Date.parse(entry.ends_at) <= Date.now()) {
    const changes = await advanceQueue(entry.queues.salon_id, entry.queue_id).catch(() => 0);
    if (changes > 0) {
      await broadcastQueueUpdate(entry.queues.salon_id).catch(() => {});
      return getTicketStatus(ticketId, accessToken); // read it again, now completed
    }
  }
  const { count: peopleAhead } = await supabase
    .from('queue_entries')
    .select('*', { count: 'exact', head: true })
    .eq('queue_id', entry.queue_id)
    .eq('status', 'WAITING')
    .lt('token_number', entry.token_number);

  const { data: salon } = await supabase
    .from('salons')
    .select('average_service_minutes')
    .eq('id', entry.queues.salon_id)
    .single();
    let prize: { name: string; code: string; redeemed: boolean } | null = null;
  if (entry.offer_id && !['CANCELLED', 'SKIPPED'].includes(entry.status)) {
    const { data: offer } = await supabase
      .from('salon_offers')
      .select('name')
      .eq('id', entry.offer_id)
      .maybeSingle();
    prize = { name: offer?.name ?? 'Reward', code: entry.prize_code, redeemed: !!entry.prize_redeemed_at };
  }
  const avg = salon?.average_service_minutes ?? 15;
  let estimatedWait = 0;

  if (entry.status === 'WAITING') {
    const { data: ahead } = await supabase
      .from('queue_entries')
      .select('status, duration_minutes, ends_at')
      .eq('queue_id', entry.queue_id)
      .in('status', ['SERVING', 'CALLED', 'WAITING'])
      .lt('token_number', entry.token_number);

    const nowMs = Date.now();
    for (const a of ahead ?? []) {
      if (a.status === 'SERVING' && a.ends_at) {
        estimatedWait += Math.max(0, Math.ceil((Date.parse(a.ends_at) - nowMs) / 60000));
      } else {
        estimatedWait += a.duration_minutes ?? avg;
      }
    }
  }

  const { data: chosen } = await supabase
    .from('queue_entry_services')
    .select('name, duration_minutes')
    .eq('queue_entry_id', entry.id)
    .order('created_at', { ascending: true });
  return {
    ticketId: entry.id,
    salonId: entry.queues.salon_id, // NEW — was already fetched via the join, just wasn't returned
    tokenNumber: entry.token_number,
    status: entry.status,
    currentToken: entry.queues.current_token,
    peopleAhead: peopleAhead ?? 0,
    estimatedWaitMinutes: estimatedWait,
    endsAt: entry.status === 'SERVING' ? entry.ends_at : null, // for the countdown
    remainingSeconds:
      entry.status === 'SERVING' && entry.ends_at
        ? Math.max(0, Math.ceil((Date.parse(entry.ends_at) - Date.now()) / 1000))
        : null,
    durationMinutes: entry.duration_minutes ?? avg,
    services: (chosen ?? []).map((s) => ({ name: s.name, durationMinutes: s.duration_minutes })),
    queueStatus: entry.queues.status,
    notificationsOn: !!entry.push_subscription, // a flag only, never the subscription itself
    prize,
  };
}

// --- Milestone 4: real-time ---

export async function getSanitizedQueueState(salonId: string) {
  const { data: queue, error: queueErr } = await supabase
    .from('queues')
    .select('id, current_token, status')
    .eq('salon_id', salonId)
    .eq('date', todayISODate()) // FIXED — this filter was missing
    .maybeSingle(); // also switched from .single() to .maybeSingle() so a
                     // genuinely-missing today's queue doesn't throw, it
                     // just returns null cleanly

  if (queueErr || !queue) return null;

  const { data: entries } = await supabase
    .from('queue_entries')
    .select('id, token_number, status')
    .eq('queue_id', queue.id)
    .in('status', ['WAITING', 'CALLED', 'SERVING'])
    .order('token_number', { ascending: true });

  const { data: salon } = await supabase
    .from('salons')
    .select('average_service_minutes')
    .eq('id', salonId)
    .single();

  return {
    salonId,
    currentToken: queue.current_token,
    queueStatus: queue.status,
    averageServiceMinutes: salon?.average_service_minutes ?? 15,
    entries: (entries ?? []).map((e) => ({
      id: e.id,
      tokenNumber: e.token_number,
      status: e.status,
    })),
  };
}

export async function broadcastQueueUpdate(
  salonId: string,
  opts: { silentEntryId?: string } = {},
) {
  const state = await getSanitizedQueueState(salonId);
  if (!state) return;
  getIO().to(`salon:${salonId}`).emit('queue:updated', state);
  await evaluateNotifications(salonId, opts);
}
export async function leaveTicket(ticketId: string, accessToken: string) {
  const { data: entry, error } = await supabase
    .from('queue_entries')
    .select('id, status, queues!inner(salon_id)')
    .eq('id', ticketId)
    .eq('access_token', accessToken)
    .maybeSingle();

  if (error || !entry) return null; // wrong id and wrong token look identical

  if (entry.status !== 'WAITING') {
    throw new AppError(
      "You can only leave the queue while you're waiting. If you've been called, please let the salon know.",
      409,
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from('queue_entries')
    .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
    .eq('id', ticketId)
    .eq('status', 'WAITING') // compare-and-swap: loses cleanly to a concurrent barber action
    .select('id')
    .maybeSingle();

  if (updateError) throw updateError;
  if (!updated) throw new AppError('This ticket was just updated. Please refresh.', 409);

  return { salonId: (entry.queues as unknown as { salon_id: string }).salon_id };
}

const ACTIVE_STATUSES = ['WAITING', 'CALLED', 'SERVING'];

// Same "wrong id and wrong token look identical" rule as the other ticket actions.
export async function savePushSubscription(ticketId: string, accessToken: string, subscription: unknown) {
  const { data, error } = await supabase
    .from('queue_entries')
    .update({ push_subscription: subscription })
    .eq('id', ticketId)
    .eq('access_token', accessToken)
    .in('status', ACTIVE_STATUSES) // nothing to notify about on a finished ticket
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function removePushSubscription(ticketId: string, accessToken: string) {
  const { data, error } = await supabase
    .from('queue_entries')
    .update({ push_subscription: null })
    .eq('id', ticketId)
    .eq('access_token', accessToken)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}