// backend/src/services/barber.service.ts
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { todayISODate } from '../utils/date';

interface QueueEntryRow {
  id: string;
  token_number: number;
  customer_name: string | null;
  customer_phone: string | null;
  status: string;
  joined_at: string;
  called_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  skipped_at: string | null;
}

// ── Dashboard read ──────────────────────────────────────────────────────

export async function getBarberQueueSnapshot(salonId: string) {
  const { data: queue, error: queueError } = await supabase
    .from('queues')
    .select('id, status, current_token, next_token')
    .eq('salon_id', salonId)
    .eq('date', todayISODate())
    .maybeSingle();

  if (queueError) throw queueError;

  if (!queue) {
    return {
      salonId, // NEW
      queueStatus: 'ACTIVE' as const,
      currentToken: 0,
      called: null,
      serving: null,
      waiting: [],
    };
  }

  const { data: entries, error: entriesError } = await supabase
    .from('queue_entries')
    .select(
      'id, token_number, customer_name, customer_phone, status, joined_at, called_at, started_at, completed_at, skipped_at',
    )
    .eq('queue_id', queue.id)
    .in('status', ['CALLED', 'SERVING', 'WAITING'])
    .order('token_number', { ascending: true });

  if (entriesError) throw entriesError;

  const rows = (entries ?? []) as QueueEntryRow[];

  return {
    salonId, // NEW
    queueStatus: queue.status as 'ACTIVE' | 'PAUSED' | 'CLOSED',
    currentToken: queue.current_token,
    called: rows.find((e) => e.status === 'CALLED') ?? null,
    serving: rows.find((e) => e.status === 'SERVING') ?? null,
    waiting: rows.filter((e) => e.status === 'WAITING'),
  };
}

// ── NEXT (atomic RPC: promotes next WAITING → CALLED) ────────────────────

export async function callNext(salonId: string) {
  const { data, error } = await supabase.rpc('barber_next', { p_salon_id: salonId });

  if (error) {
    if (error.message?.includes('NO_ACTIVE_QUEUE')) {
      throw new AppError('No customers have joined the queue today yet.', 409);
    }
    if (error.message?.includes('ALREADY_CALLED')) {
      throw new AppError('A customer is already being called. Start, complete, or skip them first.', 409);
    }
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result?.called_entry_id) {
    const didSomething = result && Object.values(result).some((v) => v != null);
    if (didSomething) return { ...result, nothingWaiting: true };
    throw new AppError('No customers are waiting.', 409);
  }

  return result;
}

// ── Ownership loader shared by start/complete/skip ───────────────────────

async function loadOwnedEntry(salonId: string, entryId: string) {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('id, status, queue_id, token_number, queues!inner(salon_id)')
    .eq('id', entryId)
    .single();

  if (error || !data || (data.queues as unknown as { salon_id: string }).salon_id !== salonId) {
    throw new AppError('Queue entry not found.', 404);
  }

  return data as unknown as { id: string; status: string; queue_id: string; token_number: number };
}

// ── START (CALLED → SERVING) ──────────────────────────────────────────────

export async function startEntry(salonId: string, entryId: string) {
  const entry = await loadOwnedEntry(salonId, entryId);

  if (entry.status !== 'CALLED') {
    throw new AppError('Only a called customer can be started.', 409);
  }

  const { data, error } = await supabase
    .from('queue_entries')
    .update({ status: 'SERVING', started_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('status', 'CALLED')
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('This entry was already updated by another action.', 409);

  return { id: entryId, status: 'SERVING' as const };
}

// ── COMPLETE (SERVING → COMPLETED) ────────────────────────────────────────

export async function completeEntry(salonId: string, entryId: string) {
  const entry = await loadOwnedEntry(salonId, entryId);

  if (entry.status !== 'SERVING') {
    throw new AppError('Only an entry currently being served can be completed.', 409);
  }

  const { data, error } = await supabase
    .from('queue_entries')
    .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('status', 'SERVING')
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('This entry was already updated by another action.', 409);

  return { id: entryId, status: 'COMPLETED' as const };
}

// ── SKIP (WAITING | CALLED | SERVING → SKIPPED) ───────────────────────────

export async function skipEntry(salonId: string, entryId: string) {
  const entry = await loadOwnedEntry(salonId, entryId);

  if (!['WAITING', 'CALLED', 'SERVING'].includes(entry.status)) {
    throw new AppError('This entry can no longer be skipped.', 409);
  }

  const { data, error } = await supabase
    .from('queue_entries')
    .update({ status: 'SKIPPED', skipped_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('status', entry.status) // guards a race with a concurrent action
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('This entry was already updated by another action.', 409);

    return {
    id: entryId,
    status: 'SKIPPED' as const,
    tokenNumber: entry.token_number,
    previousStatus: entry.status,
  };
}

// ── PAUSE / RESUME ─────────────────────────────────────────────────────

async function setQueueStatus(salonId: string, status: 'ACTIVE' | 'PAUSED') {
  const { data, error } = await supabase
    .from('queues')
    .upsert({ salon_id: salonId, date: todayISODate(), status }, { onConflict: 'salon_id,date' })
    .select('id, status')
    .single();

  if (error) throw error;
  return data;
}

export const pauseQueue = (salonId: string) => setQueueStatus(salonId, 'PAUSED');
export const resumeQueue = (salonId: string) => setQueueStatus(salonId, 'ACTIVE');