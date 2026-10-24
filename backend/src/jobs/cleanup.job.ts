// backend/src/jobs/cleanup.job.ts
import { supabase } from '../config/supabase';
import { env } from '../config/env';

let running = false;

async function runCleanup() {
  if (running) return;
  running = true;
  try {
    const { data, error } = await supabase.rpc('cleanup_customer_data', {
      p_retention_hours: env.RETENTION_HOURS,
    });
    if (error) {
      console.error(`[cleanup] failed: ${error.code ?? 'unknown'}`);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      // Counts only. Never log entry contents.
      console.log(
        `[cleanup] cancelledStale=${row?.cancelled_stale ?? 0} anonymized=${row?.anonymized ?? 0}`,
      );
    }

    const { error: pruneError, count } = await supabase
      .from('revoked_tokens')
      .delete({ count: 'exact' })
      .lt('expires_at', new Date().toISOString());
    if (pruneError) console.error(`[cleanup] token prune failed: ${pruneError.code ?? 'unknown'}`);
    else console.log(`[cleanup] revokedTokensPruned=${count ?? 0}`);
  } finally {
    running = false;
  }
}

export function startCleanupJob() {
  void runCleanup();
  const timer = setInterval(runCleanup, env.CLEANUP_INTERVAL_MINUTES * 60_000);
  timer.unref();
  return timer;
}