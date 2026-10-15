// backend/src/services/queue.service.ts
import { supabase } from '../config/supabase';
import { getIO } from '../sockets/io';

export class QueueJoinError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const JOIN_ERROR_MESSAGES: Record<string, string> = {
  SALON_NOT_FOUND: 'Salon not found.',
  SALON_CLOSED: 'Salon is currently closed.',
  QUEUE_NOT_ACTIVE: 'Queue is paused.',
};

export async function joinQueue(salonId: string, name: string, phone: string) {
  const { data, error } = await supabase.rpc('join_queue', {
    p_salon_id: salonId,
    p_customer_name: name,
    p_customer_phone: phone,
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

  return {
    ticketId: entry.id,
    salonId: entry.queues.salon_id, // NEW — was already fetched via the join, just wasn't returned
    tokenNumber: entry.token_number,
    status: entry.status,
    currentToken: entry.queues.current_token,
    peopleAhead: peopleAhead ?? 0,
    estimatedWaitMinutes: (peopleAhead ?? 0) * (salon?.average_service_minutes ?? 15),
    queueStatus: entry.queues.status,
  };
}

// --- Milestone 4: real-time ---

function todayISODate() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

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
export async function broadcastQueueUpdate(salonId: string) {
  const state = await getSanitizedQueueState(salonId);
  if (!state) return;
  getIO().to(`salon:${salonId}`).emit('queue:updated', state);
}