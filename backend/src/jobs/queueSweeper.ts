// backend/src/jobs/queueSweeper.ts
import { supabase } from '../config/supabase';
import { advanceQueue } from '../services/queueAutomation.service';
import { broadcastQueueUpdate } from '../services/queue.service';
import { todayISODate } from '../utils/date';

const INTERVAL_MS = 10_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

type Joined = { queue_id: string; queues: { salon_id: string } | { salon_id: string }[] };
const salonOf = (r: Joined) => (Array.isArray(r.queues) ? r.queues[0] : r.queues).salon_id;

// salonIds is for tests, so they never touch other salons' queues.
export async function sweepOnce(salonIds?: string[]): Promise<number> {
  const targets = new Map<string, string>(); // queueId -> salonId

  // 1. Serving entries whose time is up (any date), or that have no countdown yet.
  const due = await supabase
    .from('queue_entries')
    .select('queue_id, queues!inner(salon_id)')
    .eq('status', 'SERVING')
    .or(`ends_at.is.null,ends_at.lte.${new Date().toISOString()}`);
  if (due.error) throw due.error;

  // 2. Today's waiting customers, so an idle queue never stays stuck.
  const waiting = await supabase
    .from('queue_entries')
    .select('queue_id, queues!inner(salon_id, date)')
    .eq('status', 'WAITING')
    .eq('queues.date', todayISODate());
  if (waiting.error) throw waiting.error;

  for (const r of [...(due.data ?? []), ...(waiting.data ?? [])] as unknown as Joined[]) {
    const salonId = salonOf(r);
    if (!salonIds || salonIds.includes(salonId)) targets.set(r.queue_id, salonId);
  }

  let changes = 0;
  for (const [queueId, salonId] of targets) {
    try {
      const n = await advanceQueue(salonId, queueId);
      changes += n;
      if (n > 0) await broadcastQueueUpdate(salonId).catch(() => {});
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      console.error(`[sweeper] advance failed salon=${salonId} (${name})`);
    }
  }
  return changes;
}

export function startQueueSweeper() {
  if (process.env.NODE_ENV === 'test' || timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweepOnce();
    } catch {
      console.error('[sweeper] sweep failed');
    } finally {
      running = false;
    }
  }, INTERVAL_MS);
  timer.unref();
}