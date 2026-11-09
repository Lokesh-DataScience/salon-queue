// backend/src/services/barber.service.ts
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { todayISODate } from '../utils/date';
import { compareServeOrder } from '../utils/serveOrder';
import type { BarberScope } from './barberScope.service';

// Older callers, and the existing tests, pass just a salon id. That still means what it always
// meant: the whole salon, one barber. Anything that knows about barbers passes a BarberScope.
type ScopeOrSalonId = BarberScope | string;
function asScope(input: ScopeOrSalonId): BarberScope {
  if (typeof input !== 'string') return input;
  return {
    salonId: input,
    staffId: '',
    isOwner: true,
    multi: false,
    laneId: '',
    laneName: '',
    laneIsPaused: false,
    ownLaneId: '',
    lanes: [],
    entryLaneId: null,
  };
}

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
  priority_at: string | null;
  lane_id?: string | null;
}

// above getBarberQueueSnapshot
function byServeOrder(a: QueueEntryRow, b: QueueEntryRow) {
  if (a.priority_at && b.priority_at) return Date.parse(a.priority_at) - Date.parse(b.priority_at);
  if (a.priority_at) return -1;
  if (b.priority_at) return 1;
  return a.token_number - b.token_number;
}

// ── PRIORITY: serve a waiting customer right after the current one ──────────
export async function moveToFront(salonId: string, entryId: string, entryLaneId?: string | null) {
  await assertEntryAccess(salonId, entryId, entryLaneId); // staff: their own line only
  const { data, error } = await supabase.rpc('move_to_front', {
    p_salon_id: salonId,
    p_entry_id: entryId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('ENTRY_NOT_FOUND')) throw new AppError('Queue entry not found.', 404);
    if (msg.includes('NOT_WAITING')) throw new AppError('Only a waiting customer can be moved up.', 409);
    if (msg.includes('ALREADY_NEXT')) throw new AppError('This customer is already next.', 409);
    if (msg.includes('ALREADY_PRIORITY')) throw new AppError('This customer was already moved up.', 409);
    throw error;
  }
  return { id: entryId, tokenNumber: data as number };
}

// ── Dashboard read ──────────────────────────────────────────────────────

export async function getBarberQueueSnapshot(input: ScopeOrSalonId) {
  const scope = asScope(input);
  const { salonId } = scope;
  const { data: queue, error: queueError } = await supabase
    .from('queues')
    .select('id, status, current_token, next_token')
    .eq('salon_id', salonId)
    .eq('date', todayISODate())
    .maybeSingle();

  if (queueError) throw queueError;

  // With several barbers the dashboard is about ONE line; with one barber it is the whole queue, as always.
  const lane = scope.multi ? { id: scope.laneId, name: scope.laneName, isPaused: scope.laneIsPaused } : null;
  const effectiveStatus = (queueStatus: string) =>
    queueStatus !== 'ACTIVE' ? queueStatus : scope.multi && scope.laneIsPaused ? 'PAUSED' : 'ACTIVE';

  if (!queue) {
    return {
      salonId,
      queueStatus: effectiveStatus('ACTIVE') as 'ACTIVE' | 'PAUSED' | 'CLOSED',
      currentToken: 0,
      called: null,
      serving: null,
      waiting: [],
      lane,
      lanes: ownerLaneList(scope, []),
    };
  }

  const { data: entries, error: entriesError } = await supabase
    .from('queue_entries')
    .select(
      'id, token_number, status, joined_at, called_at, started_at, completed_at, skipped_at, priority_at, lane_id, salon_customers(name, phone)'
    )
    .eq('queue_id', queue.id)
    .in('status', ['CALLED', 'SERVING', 'WAITING'])
    .order('token_number', { ascending: true });

  if (entriesError) throw entriesError;

  type RawEntry = Omit<QueueEntryRow, 'customer_name' | 'customer_phone'> & {
    salon_customers: { name: string; phone: string } | null;
  };
  const all: QueueEntryRow[] = ((entries ?? []) as unknown as RawEntry[]).map(({ salon_customers, ...e }) => ({
    ...e,
    customer_name: salon_customers?.name ?? null, // walk-ins have no customer row
    customer_phone: salon_customers?.phone ?? null,
  }));
  const rows = scope.multi ? all.filter((e) => e.lane_id === scope.laneId) : all;
  const called = rows.find((e) => e.status === 'CALLED') ?? null;
  const serving = rows.find((e) => e.status === 'SERVING') ?? null;

  let currentToken: number = queue.current_token;
  if (scope.multi) {
    // "Current token" of this barber's line: who they are with now, or the last one they started.
    const live = serving ?? called;
    if (live) {
      currentToken = live.token_number;
    } else {
      const { data: last } = await supabase
        .from('queue_entries')
        .select('token_number')
        .eq('queue_id', queue.id)
        .eq('lane_id', scope.laneId)
        .not('started_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      currentToken = last?.token_number ?? 0;
    }
  }

  return {
    salonId,
    queueStatus: effectiveStatus(queue.status) as 'ACTIVE' | 'PAUSED' | 'CLOSED',
    currentToken,
    called,
    serving,
    waiting: rows.filter((e) => e.status === 'WAITING').sort(compareServeOrder),
    lane,
    lanes: ownerLaneList(scope, all),
  };
}

// The owner's line switcher: every active line with how many are waiting. Staff never get this.
function ownerLaneList(scope: BarberScope, active: QueueEntryRow[]) {
  if (!scope.multi || !scope.isOwner) return null;
  return scope.lanes
    .filter((l) => l.isActive)
    .map((l) => ({
      id: l.id,
      name: l.name,
      isMine: l.id === scope.ownLaneId,
      isPaused: l.isPaused,
      waitingCount: active.filter((e) => e.lane_id === l.id && e.status === 'WAITING').length,
      busy: active.some((e) => e.lane_id === l.id && (e.status === 'SERVING' || e.status === 'CALLED')),
    }));
}

// ── NEXT (atomic RPC: promotes next WAITING → CALLED) ────────────────────

export async function callNext(input: ScopeOrSalonId) {
  const scope = asScope(input);
  const { data, error } = await supabase.rpc('barber_next', {
    p_salon_id: scope.salonId,
    p_lane_id: scope.multi ? scope.laneId : null, // one barber: the default line, as before
  });

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

// entryLaneId: staff may only touch customers in their own line (null = any line of the salon).
// Another salon's entry and another barber's entry both look like "not found".
async function loadOwnedEntry(salonId: string, entryId: string, entryLaneId?: string | null) {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('id, status, queue_id, token_number, lane_id, queues!inner(salon_id)')
    .eq('id', entryId)
    .single();

  if (
    error ||
    !data ||
    (data.queues as unknown as { salon_id: string }).salon_id !== salonId ||
    (entryLaneId && data.lane_id !== entryLaneId)
  ) {
    throw new AppError('Queue entry not found.', 404);
  }

  return data as unknown as { id: string; status: string; queue_id: string; token_number: number };
}

export async function assertEntryAccess(salonId: string, entryId: string, entryLaneId?: string | null) {
  await loadOwnedEntry(salonId, entryId, entryLaneId);
}

// ── START (CALLED → SERVING) ──────────────────────────────────────────────

export async function startEntry(salonId: string, entryId: string, entryLaneId?: string | null) {
  const entry = await loadOwnedEntry(salonId, entryId, entryLaneId);

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

export async function completeEntry(salonId: string, entryId: string, entryLaneId?: string | null) {
  const entry = await loadOwnedEntry(salonId, entryId, entryLaneId);

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

export async function skipEntry(salonId: string, entryId: string, entryLaneId?: string | null) {
  const entry = await loadOwnedEntry(salonId, entryId, entryLaneId);

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

async function setLanePaused(salonId: string, laneId: string, paused: boolean) {
  const { error } = await supabase.rpc('set_lane_paused', {
    p_salon_id: salonId,
    p_lane_id: laneId,
    p_paused: paused,
  });
  if (error) {
    if (error.message?.includes('LANE_NOT_FOUND')) throw new AppError('Line not found.', 404);
    throw error;
  }
}

// One barber: the pause button pauses the whole queue, exactly as it always has.
// Several barbers: it is a break for the line on screen, and everyone else keeps working.
export async function pauseForScope(scope: BarberScope) {
  if (!scope.multi) return pauseQueue(scope.salonId);
  await setLanePaused(scope.salonId, scope.laneId, true);
  return { status: 'PAUSED' as const };
}

export async function resumeForScope(scope: BarberScope) {
  if (!scope.multi) return resumeQueue(scope.salonId);
  await setLanePaused(scope.salonId, scope.laneId, false);
  // A whole-salon pause made back when there was one barber must not keep this line stuck.
  const { data: queue } = await supabase
    .from('queues')
    .select('status')
    .eq('salon_id', scope.salonId)
    .eq('date', todayISODate())
    .maybeSingle();
  if (queue?.status === 'PAUSED') await resumeQueue(scope.salonId);
  return { status: 'ACTIVE' as const };
}

// ── WALK-IN (+1) ──────────────────────────────────────────────────────────
// For customers with no smartphone: the barber adds them to the end of today's queue.
export async function addWalkIn(input: ScopeOrSalonId) {
  const scope = asScope(input);
  const { data, error } = await supabase.rpc('add_walk_in', {
    p_salon_id: scope.salonId,
    p_lane_id: scope.multi ? scope.laneId : null, // one barber: the default line, as before
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('SALON_NOT_FOUND')) throw new AppError('Salon not found.', 404);
    if (msg.includes('SALON_CLOSED')) {
      throw new AppError('The salon is closed right now, so no one can be added.', 409);
    }
    if (msg.includes('QUEUE_NOT_ACTIVE')) {
      throw new AppError('The queue is paused. Resume it to add a walk-in.', 409);
    }
    if (msg.includes('LANE_PAUSED')) {
      throw new AppError('This line is on a break. Resume it to add a walk-in.', 409);
    }
    if (msg.includes('LANE_NOT_FOUND') || msg.includes('LANE_INACTIVE')) {
      throw new AppError("This barber's line isn't available.", 409);
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.entry_id) throw new AppError('Could not add the walk-in. Please try again.', 500);

  return {
    id: row.entry_id as string,
    tokenNumber: row.token_number as number,
    laneName: scope.multi ? scope.laneName : null, // so the dashboard can say whose line it joined
  };
}
