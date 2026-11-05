// backend/src/services/queueAutomation.service.ts
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { todayISODate } from '../utils/date';

// Completes due entries and promotes the next WAITING one. The SQL function is idempotent
// and locks the queue row. Returns how many changes happened (completions + starts).
// It does not broadcast or notify: callers broadcast, and the broadcast evaluates notifications.
export async function advanceQueue(_salonId: string, queueId: string): Promise<number> {
  const { data, error } = await supabase.rpc('advance_queue', { p_queue_id: queueId });
  if (error) throw error;
  return ((data ?? []) as unknown[]).length;
}

async function todayQueueId(salonId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('queues')
    .select('id')
    .eq('salon_id', salonId)
    .eq('date', todayISODate())
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function advanceSalonQueue(salonId: string): Promise<number> {
  const queueId = await todayQueueId(salonId);
  return queueId ? advanceQueue(salonId, queueId) : 0;
}

export async function extendEntry(salonId: string, entryId: string, minutes: number) {
  const { data, error } = await supabase.rpc('extend_entry', {
    p_salon_id: salonId,
    p_entry_id: entryId,
    p_minutes: minutes,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('ENTRY_NOT_FOUND')) throw new AppError('Queue entry not found.', 404);
    if (msg.includes('NOT_SERVING')) {
      throw new AppError('This customer is not being served, or their time is already up.', 409);
    }
    throw error;
  }
  return { endsAt: data as string };
}