// backend/src/services/testPush.service.ts
// Customer app polish, slice 3a: "Send a test notification" on the ticket page.
// Lets a customer check that alerts reach this phone before they leave home.
// Authorised by the ticket's own access token. Sends only to the subscription already saved on
// that ticket, so it can never be pointed at another device. No names or phones anywhere.
import * as webpush from 'web-push';
import { env } from '../config/env';
import { supabase } from '../config/supabase';

const ACTIVE = ['WAITING', 'CALLED', 'SERVING'];
const COOLDOWN_MS = 30_000;
const MAX_TRACKED = 5_000;

// ticketId -> last test sent. In memory: a restart simply resets the cooldown.
const lastSent = new Map<string, number>();

export type TestPushResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'PUSH_DISABLED' | 'NO_SUBSCRIPTION' | 'TOO_SOON' | 'EXPIRED' | 'FAILED' };

export function buildTestMessage(tokenNumber: number, lang: 'hi' | 'en', url: string) {
  return lang === 'en'
    ? {
        title: 'Test notification',
        body: `Token #${tokenNumber}: notifications are working. We'll alert you like this when your turn is close.`,
        url,
      }
    : {
        title: 'टेस्ट सूचना',
        body: `टोकन #${tokenNumber}: सूचनाएँ ठीक काम कर रही हैं। बारी पास आने पर ऐसे ही बताएँगे।`,
        url,
      };
}

export async function sendTestPush(ticketId: string, accessToken: string, lang: 'hi' | 'en'): Promise<TestPushResult> {
  const { data: row, error } = await supabase
    .from('queue_entries')
    .select('id, token_number, status, access_token, push_subscription')
    .eq('id', ticketId)
    .eq('access_token', accessToken)
    .maybeSingle();
  if (error) throw error;
  if (!row || !ACTIVE.includes(row.status as string)) return { ok: false, reason: 'NOT_FOUND' };

  if (env.NOTIFICATION_PROVIDER !== 'webpush') return { ok: false, reason: 'PUSH_DISABLED' };
  if (!row.push_subscription) return { ok: false, reason: 'NO_SUBSCRIPTION' };

  const now = Date.now();
  const last = lastSent.get(ticketId);
  if (last !== undefined && now - last < COOLDOWN_MS) return { ok: false, reason: 'TOO_SOON' };
  if (lastSent.size >= MAX_TRACKED) lastSent.clear();
  lastSent.set(ticketId, now);

  const url = `/tickets/${row.id}?accessToken=${row.access_token}`;
  const message = buildTestMessage(row.token_number as number, lang, url);
  try {
    await webpush.sendNotification(row.push_subscription as webpush.PushSubscription, JSON.stringify(message), {
      TTL: 60,
      urgency: 'high',
    });
    console.log(`[notify] TEST entry=${row.id}`); // ids only
    return { ok: true };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      // The browser dropped this subscription: forget it so the page offers "turn on" again.
      await supabase.from('queue_entries').update({ push_subscription: null }).eq('id', row.id);
      return { ok: false, reason: 'EXPIRED' };
    }
    // Name / status only: push errors carry the endpoint, which is an identifier.
    console.error(`[notify] TEST failed entry=${row.id} (${status ? `HTTP_${status}` : err instanceof Error ? err.name : 'Error'})`);
    return { ok: false, reason: 'FAILED' };
  }
}

// Tests only.
export function resetTestPushCooldown() {
  lastSent.clear();
}
