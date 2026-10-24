// backend/src/services/queueNotifications.service.ts
import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { todayISODate } from '../utils/date';
import { NotificationService } from './notification.service';

// Stages: 0 none, 1 "getting close", 2 "you're next", 3 "your turn".
// "People ahead" is INCLUSIVE: WAITING + CALLED + SERVING entries before you.
function desiredStage(status: string, peopleAhead: number): number {
  if (status === 'CALLED') return 3;
  if (status !== 'WAITING') return 0;
  if (peopleAhead <= env.NOTIFY_NEXT_AT) return 2;
  if (peopleAhead <= env.NOTIFY_CLOSE_AT) return 1;
  return 0;
}

export async function evaluateNotifications(
  salonId: string,
  opts: { silentEntryId?: string } = {},
) {
  try {
    const { data: queue } = await supabase
      .from('queues')
      .select('id')
      .eq('salon_id', salonId)
      .eq('date', todayISODate())
      .maybeSingle();
    if (!queue) return;

    const { data: entries } = await supabase
      .from('queue_entries')
      .select('id, token_number, status, notified_stage')
      .eq('queue_id', queue.id)
      .in('status', ['WAITING', 'CALLED', 'SERVING'])
      .order('token_number', { ascending: true });
    if (!entries) return;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const stage = desiredStage(e.status, i); // i = active entries ahead of this one
      if (stage <= e.notified_stage) continue;

      // Atomic claim: a single conditional UPDATE. If two evaluations race,
      // only one gets a row back, so each stage fires at most once per ticket.
      const { data: claimed } = await supabase
        .from('queue_entries')
        .update({ notified_stage: stage })
        .eq('id', e.id)
        .lt('notified_stage', stage)
        .select('id')
        .maybeSingle();

      // Silent claim for a customer who just joined: record the stage they
      // already sit at without sending an instant "you're next".
      if (!claimed || e.id === opts.silentEntryId) continue;

      const target = { entryId: e.id, salonId, tokenNumber: e.token_number };
      if (stage === 3) await NotificationService.notifyTurnNow(target);
      else await NotificationService.notifyQueueApproaching(target, i);
    }
  } catch (err) {
    console.error(`[notify] evaluation failed salon=${salonId}`); // no error object: may echo row data
  }
}