// backend/src/jobs/shopReminders.job.ts — Commerce C5a (§15.2, D27): remind the founder about orders still PLACED.
// Every 5 minutes, ONE database statement claims the due orders (first after 30 min, then every 2 h — editable in
// Shop settings) and the founder's devices get "Order SQ-1042 is waiting for your action". Never changes an order.
// The claim is atomic, so a restart or two servers never send the same reminder twice. A failed push is just
// logged (ids only) and comes again at the next repeat.
import { supabase } from '../config/supabase';
import { errorCode, recordFailure, recordSuccess } from '../services/heartbeat.service';
import { buildShopReminderMessage, notifyStaffIds, shopStaffIds } from '../services/staffPush.service';

const EVERY_MS = 5 * 60_000;
let running = false;

export async function runShopReminders(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const { data, error } = await supabase.rpc('claim_due_placed_reminders');
    if (error) {
      // Before step24 runs (or on a database hiccup): report it, try again next time.
      await recordFailure('shop_reminders', String(error.code ?? 'unknown'));
      return 0;
    }
    const due = (data ?? []) as { order_id: string; order_number: string }[];
    if (due.length > 0) {
      const founders = await shopStaffIds(['FOUNDER']);
      for (const o of due) await notifyStaffIds(founders, buildShopReminderMessage(o.order_id, o.order_number), `SHOP_REMINDER ${o.order_number}`);
    }
    await recordSuccess('shop_reminders', { reminded: due.length });
    return due.length;
  } catch (err) {
    console.error('[shop-reminders] crashed');
    await recordFailure('shop_reminders', errorCode(err));
    return 0;
  } finally {
    running = false;
  }
}

export function startShopRemindersJob() {
  const timer = setInterval(() => void runShopReminders(), EVERY_MS);
  timer.unref();
  return timer;
}
