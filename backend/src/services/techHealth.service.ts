// backend/src/services/techHealth.service.ts
// Everything the Tech tab's health panel shows. Read-only; no customer data.
import { performance } from 'perf_hooks';
import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { getIO } from '../sockets/io';
import { PROCESS_STARTED_AT, type HeartbeatName } from './heartbeat.service';

export type CheckStatus = 'ok' | 'late' | 'failing' | 'unknown';

interface HeartbeatRow {
  name: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_code: string | null;
  last_detail: Record<string, unknown> | null;
}

const JOBS: { name: HeartbeatName; label: string; schedule: string; lateAfterMs: number; note?: string }[] = [
  { name: 'sweeper', label: 'Queue sweeper', schedule: 'every 10 seconds', lateAfterMs: 2 * 60_000 },
  {
    name: 'cleanup',
    label: 'Privacy cleanup',
    schedule: `every ${env.CLEANUP_INTERVAL_MINUTES} minutes`,
    lateAfterMs: (2 * env.CLEANUP_INTERVAL_MINUTES + 5) * 60_000,
  },
  { name: 'news', label: 'Local news refresh', schedule: 'every 15 minutes', lateAfterMs: 40 * 60_000 },
  {
    name: 'pinger',
    label: 'Uptime pinger (cron-job.org)',
    schedule: 'as set in cron-job.org',
    lateAfterMs: 30 * 60_000,
    note: 'Late is normal outside the hours the pinger is set to run.',
  },
];

export function statusOf(row: HeartbeatRow | undefined, lateAfterMs: number, now = Date.now()): CheckStatus {
  if (!row || (!row.last_success_at && !row.last_failure_at)) return 'unknown';
  const ok = row.last_success_at ? Date.parse(row.last_success_at) : 0;
  const bad = row.last_failure_at ? Date.parse(row.last_failure_at) : 0;
  if (bad > ok) return 'failing';
  if (now - ok > lateAfterMs) return 'late';
  return 'ok';
}

function socketCount(): number | null {
  try {
    const io = getIO() as unknown as { engine?: { clientsCount?: number } };
    return typeof io.engine?.clientsCount === 'number' ? io.engine.clientsCount : null;
  } catch {
    return null;
  }
}

export async function getTechHealth() {
  const now = Date.now();

  // Database: one tiny query, timed.
  const t0 = performance.now();
  const { error: dbError } = await supabase.from('salons').select('id', { count: 'exact', head: true });
  const dbMs = Math.round(performance.now() - t0);
  const database = {
    status: (dbError ? 'failing' : dbMs >= 1000 ? 'late' : 'ok') as CheckStatus,
    responseMs: dbError ? null : dbMs,
    errorCode: dbError ? String(dbError.code ?? 'unknown') : null,
  };

  const { data: rows, error } = await supabase
    .from('job_heartbeats')
    .select('name, last_success_at, last_failure_at, last_failure_code, last_detail');
  if (error) throw error;
  const byName = new Map(((rows ?? []) as HeartbeatRow[]).map((r) => [r.name, r]));

  const jobs = JOBS.map((j) => {
    const r = byName.get(j.name);
    return {
      name: j.name,
      label: j.label,
      schedule: j.schedule,
      note: j.note ?? null,
      status: statusOf(r, j.lateAfterMs, now),
      lastSuccessAt: r?.last_success_at ?? null,
      lastFailureAt: r?.last_failure_at ?? null,
      lastFailureCode: r?.last_failure_code ?? null,
      detail: r?.last_detail ?? {},
    };
  });

  const mem = process.memoryUsage();
  const commit = process.env.RENDER_GIT_COMMIT ?? null;

  return {
    checkedAt: new Date(now).toISOString(),
    database,
    jobs,
    sockets: socketCount(),
    server: {
      startedAt: PROCESS_STARTED_AT.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(mem.rss / 1_048_576),
      heapUsedMb: Math.round(mem.heapUsed / 1_048_576),
      nodeVersion: process.version,
      environment: env.NODE_ENV,
    },
    build: {
      commit: commit ? commit.slice(0, 7) : null,
      branch: process.env.RENDER_GIT_BRANCH ?? null,
    },
  };
}
