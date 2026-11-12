// backend/src/services/heartbeat.service.ts
// Background jobs report here so the Tech tab can show "last ran OK / last failed".
// Successes are written at most once a minute (the sweeper runs every 10 s); a success right
// after a failure is written straight away, so recovery shows at once. Never throws.
import { supabase } from '../config/supabase';

export type HeartbeatName = 'sweeper' | 'cleanup' | 'news' | 'pinger';

export const PROCESS_STARTED_AT = new Date();

const SUCCESS_EVERY_MS = 60_000;
const FAILURE_EVERY_MS = 30_000;
const lastSuccessWrite = new Map<string, number>();
const lastFailureWrite = new Map<string, number>();

// A short, safe code for an error: database/system code or the error's class name. Never its message.
export function errorCode(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown } | null;
  const raw = typeof e?.code === 'string' || typeof e?.code === 'number' ? String(e.code)
    : typeof e?.name === 'string' ? e.name : 'Error';
  return raw.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'Error';
}

async function upsert(row: Record<string, unknown>) {
  try {
    const { error } = await supabase.from('job_heartbeats').upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: 'name' },
    );
    if (error) console.error(`[heartbeat] write failed: ${error.code ?? 'unknown'}`);
  } catch {
    console.error('[heartbeat] write failed');
  }
}

export async function recordSuccess(name: HeartbeatName, detail: Record<string, number | string> = {}) {
  const now = Date.now();
  const lastOk = lastSuccessWrite.get(name) ?? 0;
  const lastBad = lastFailureWrite.get(name) ?? 0;
  const recovering = lastBad > lastOk;
  if (!recovering && now - lastOk < SUCCESS_EVERY_MS) return;
  lastSuccessWrite.set(name, now);
  await upsert({ name, last_success_at: new Date(now).toISOString(), last_detail: detail });
}

export async function recordFailure(name: HeartbeatName, code: string) {
  const now = Date.now();
  if (now - (lastFailureWrite.get(name) ?? 0) < FAILURE_EVERY_MS) return;
  lastFailureWrite.set(name, now);
  await upsert({ name, last_failure_at: new Date(now).toISOString(), last_failure_code: code.slice(0, 40) });
}

// Tests only: forget the throttling so each test writes immediately.
export function resetHeartbeatThrottle() {
  lastSuccessWrite.clear();
  lastFailureWrite.clear();
}
