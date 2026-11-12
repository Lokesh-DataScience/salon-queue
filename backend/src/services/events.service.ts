// backend/src/services/events.service.ts
// A small, privacy-safe log of server errors, sign-in problems and rate-limit hits for the Tech tab.
// Stores codes and route shapes only — never messages, bodies, IPs, names or phone numbers.
// Writes are fire-and-forget, capped per minute (a flood can't fill the database), and never throw.
import { supabase } from '../config/supabase';

export type EventKind = 'error' | 'auth' | 'rate_limit';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_WRITES_PER_MINUTE = 120;
let windowStart = 0;
let writesInWindow = 0;

// "/api/admin/founder/salons/3f2a…/suspension" → "/api/admin/founder/salons/:id/suspension"
export function normalizeRoute(path: string): string {
  return path
    .split('?')[0]
    .replace(UUID, ':id')
    .replace(/\/(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{12,}(?=\/|$)/g, '/:token') // long values with digits (QR codes, tokens)
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 200);
}

const safeCode = (code: string) => code.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60) || 'unknown';
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function recordEvent(e: {
  kind: EventKind;
  code: string;
  route?: string;
  status?: number;
  staffId?: string | null;
}) {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    writesInWindow = 0;
  }
  if (writesInWindow >= MAX_WRITES_PER_MINUTE) return;
  writesInWindow += 1;

  try {
    const { error } = await supabase.from('app_events').insert({
      kind: e.kind,
      code: safeCode(e.code),
      route: e.route ? normalizeRoute(e.route) : null,
      status: e.status ?? null,
      staff_id: isUuid(e.staffId) ? e.staffId : null,
    });
    if (error) console.error(`[events] write failed: ${error.code ?? 'unknown'}`);
  } catch {
    console.error('[events] write failed');
  }
}

// Sign-in problems. Default route is the refresh endpoint, where silent logouts happen.
export function recordAuthEvent(code: string, staffId?: string | null, route = '/api/auth/barber/refresh', status = 401) {
  return recordEvent({ kind: 'auth', code, staffId, route, status });
}

// ── Reading, for the Tech tab ─────────────────────────────────────────────

interface EventRow {
  id: number;
  created_at: string;
  kind: EventKind;
  code: string;
  route: string | null;
  status: number | null;
  staff_id: string | null;
}

export async function getEventSummary(days: 1 | 7) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('app_events')
    .select('id, created_at, kind, code, route, status, staff_id')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  const rows = (data ?? []) as EventRow[];

  const groups = new Map<
    string,
    { kind: EventKind; code: string; route: string | null; count: number; lastAt: string; staff: Set<string> }
  >();
  for (const r of rows) {
    // Errors are grouped by code + route; sign-in problems and rate limits by code only.
    const route = r.kind === 'error' ? r.route : null;
    const key = `${r.kind}|${r.code}|${route ?? ''}`;
    const g = groups.get(key) ?? { kind: r.kind, code: r.code, route, count: 0, lastAt: r.created_at, staff: new Set() };
    g.count += 1;
    if (r.staff_id) g.staff.add(r.staff_id);
    groups.set(key, g);
  }

  const list = [...groups.values()]
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
    .map(({ staff, ...g }) => ({ ...g, accounts: staff.size }));

  return {
    days,
    total: rows.length,
    truncated: rows.length === 5000,
    errors: list.filter((g) => g.kind === 'error'),
    auth: list.filter((g) => g.kind === 'auth'),
    rateLimits: list.filter((g) => g.kind === 'rate_limit'),
    recent: rows.slice(0, 50).map((r) => ({
      id: r.id,
      at: r.created_at,
      kind: r.kind,
      code: r.code,
      route: r.route,
      status: r.status,
    })),
  };
}

// Called by the cleanup job.
export async function pruneOldEvents(days = 14) {
  const { error, count } = await supabase
    .from('app_events')
    .delete({ count: 'exact' })
    .lt('created_at', new Date(Date.now() - days * 86_400_000).toISOString());
  if (error) throw error;
  return count ?? 0;
}
