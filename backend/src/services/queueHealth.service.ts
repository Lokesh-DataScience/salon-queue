// backend/src/services/queueHealth.service.ts
// Tech tab → Queues: integrity checks, today's notification numbers, and a read-only look at any
// salon's queue. Token numbers and statuses only — never names, phones, ticket tokens or prize codes.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { todayISODate } from '../utils/date';
import { getPushDelivery } from './pushStats.service';

type Rows = Array<Record<string, unknown>>;

const CHECKS = [
  { id: 'duplicate_tokens', label: 'Same token given twice', serious: true },
  { id: 'double_serving', label: 'Two customers serving at once in one line', serious: true },
  { id: 'overdue_serving', label: 'Service ran 2+ minutes past its end time', serious: false },
  { id: 'stale_active', label: "Open tickets left from an earlier day", serious: false },
  { id: 'stuck_paused', label: 'Queue paused 2+ hours with people waiting', serious: false },
] as const;

export async function getQueueHealth() {
  const { data, error } = await supabase.rpc('tech_queue_health');
  if (error) throw error;
  if (!data) throw new AppError('Could not run the queue checks.', 500);
  const d = data as Record<string, unknown>;
  const p = (d.push_today ?? {}) as Record<string, number>;

  return {
    checkedAt: d.checked_at as string,
    checks: CHECKS.map((c) => {
      const rows = (d[c.id] as Rows) ?? [];
      return { id: c.id, label: c.label, serious: c.serious, count: rows.length, rows };
    }),
    pushToday: {
      qrTickets: p.qr_tickets ?? 0,
      withPush: p.with_push ?? 0,
      gotClose: p.got_close ?? 0,
      gotNext: p.got_next ?? 0,
      gotTurn: p.got_turn ?? 0,
    },
    pushDelivery: await getPushDelivery(7), // Slice 9b
  };
}

// Plain words only: PostgREST filter syntax uses , ( ) . : * %
const clean = (s?: string) => (s ?? '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);

export async function searchSalonsForTech(search?: string) {
  let q = supabase
    .from('salons')
    .select('id, name, address, is_internal, is_suspended')
    .order('name')
    .limit(30);
  const s = clean(search);
  if (s) q = q.or(`name.ilike.%${s}%,address.ilike.%${s}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    address: r.address as string,
    isInternal: !!r.is_internal,
    isSuspended: !!r.is_suspended,
  }));
}

export async function getSalonQueueReadOnly(salonId: string) {
  const { data: salon, error: sErr } = await supabase
    .from('salons')
    .select('id, name, is_open, is_queue_active, is_suspended, opening_time, closing_time')
    .eq('id', salonId)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!salon) throw new AppError('Salon not found.', 404);

  const date = todayISODate();
  const { data: queue, error: qErr } = await supabase
    .from('queues')
    .select('id, status, next_token, updated_at')
    .eq('salon_id', salonId)
    .eq('date', date)
    .maybeSingle();
  if (qErr) throw qErr;

  let entries: Rows = [];
  if (queue) {
    // An explicit column list: customer details, ticket tokens and prize codes are never selected.
    const { data, error } = await supabase
      .from('queue_entries')
      .select('token_number, status, is_walk_in, joined_at, started_at, ends_at, completed_at, priority_at, lane_id, duration_minutes, notified_stage')
      .eq('queue_id', queue.id)
      .order('token_number');
    if (error) throw error;
    entries = data ?? [];
  }

  // Number the barber lines 1, 2, 3… in a stable order, instead of showing ids.
  const laneOrder = [...new Set(entries.map((e) => e.lane_id as string | null).filter(Boolean))] as string[];
  return {
    salon: {
      id: salon.id,
      name: salon.name,
      isOpen: salon.is_open,
      isQueueActive: salon.is_queue_active,
      isSuspended: !!salon.is_suspended,
      hours: `${salon.opening_time}–${salon.closing_time}`,
    },
    date,
    queue: queue ? { status: queue.status as string, nextToken: queue.next_token as number, updatedAt: queue.updated_at as string } : null,
    entries: entries.map((e) => ({
      token: e.token_number as number,
      status: e.status as string,
      walkIn: !!e.is_walk_in,
      line: e.lane_id ? laneOrder.indexOf(e.lane_id as string) + 1 : null,
      joinedAt: e.joined_at as string,
      startedAt: (e.started_at as string | null) ?? null,
      endsAt: (e.ends_at as string | null) ?? null,
      completedAt: (e.completed_at as string | null) ?? null,
      priority: !!e.priority_at,
      durationMinutes: (e.duration_minutes as number | null) ?? null,
      notifiedStage: (e.notified_stage as number | null) ?? 0,
    })),
  };
}
