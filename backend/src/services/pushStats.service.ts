// backend/src/services/pushStats.service.ts
// Daily counts of what the push services answered (sent / expired / failed). Never throws:
// a counting problem must never stop a notification or a queue action.
import { supabase } from '../config/supabase';

export type PushOutcome = 'sent' | 'expired' | 'failed';

export async function recordPush(kind: PushOutcome, code?: string) {
  try {
    const { error } = await supabase.rpc('bump_push_stat', { p_kind: kind, p_code: code ?? null });
    if (error) console.error(`[push-stats] write failed: ${error.code ?? 'unknown'}`);
  } catch {
    console.error('[push-stats] write failed');
  }
}

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export async function getPushDelivery(days = 7) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  const sinceDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(since);
  const { data, error } = await supabase
    .from('push_daily')
    .select('day, sent, expired, failed, last_failure_code')
    .gte('day', sinceDay)
    .order('day', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []).map((r) => ({
    day: r.day as string,
    sent: r.sent as number,
    expired: r.expired as number,
    failed: r.failed as number,
    lastFailureCode: (r.last_failure_code as string | null) ?? null,
  }));
  const today = todayInIndia();
  const empty = { day: today, sent: 0, expired: 0, failed: 0, lastFailureCode: null };
  return {
    today: rows.find((r) => r.day === today) ?? empty,
    lastDays: rows,
    total: rows.reduce(
      (t, r) => ({ sent: t.sent + r.sent, expired: t.expired + r.expired, failed: t.failed + r.failed }),
      { sent: 0, expired: 0, failed: 0 },
    ),
  };
}
