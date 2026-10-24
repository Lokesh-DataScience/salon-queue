// backend/src/services/notification.service.ts
import * as webpush from 'web-push';
import { env } from '../config/env';
import { supabase } from '../config/supabase';

export type NotificationEvent = 'QUEUE_APPROACHING' | 'TURN_NOW' | 'QUEUE_CANCELLED';

// Deliberately NO name or phone here. Providers look up whatever they need by entryId,
// so personal data never passes through this layer or its logs.
export interface NotificationTarget {
  entryId: string;
  salonId: string;
  tokenNumber: number;
}

export interface NotificationProvider {
  send(
    event: NotificationEvent,
    target: NotificationTarget,
    data?: { peopleAhead?: number },
  ): Promise<void>;
}

function logLine(event: NotificationEvent, target: NotificationTarget, data?: { peopleAhead?: number }) {
  const ahead = data?.peopleAhead !== undefined ? ` ahead=${data.peopleAhead}` : '';
  console.log(`[notify] ${event} salon=${target.salonId} token=${target.tokenNumber}${ahead}`);
}

class ConsoleProvider implements NotificationProvider {
  async send(event: NotificationEvent, target: NotificationTarget, data?: { peopleAhead?: number }) {
    logLine(event, target, data);
  }
}

// ── Web Push ──────────────────────────────────────────────────────────────

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

// Wording avoids numbers: the tracking page and the notification count "people ahead" slightly differently.
export function buildPushMessage(
  event: NotificationEvent,
  target: NotificationTarget,
  data: { peopleAhead?: number } | undefined,
  accessToken: string,
): PushMessage {
  const url = `/tickets/${target.entryId}?accessToken=${accessToken}`;
  const n = target.tokenNumber;
  switch (event) {
    case 'TURN_NOW':
      return { title: "It's your turn", body: `Token #${n}: please head to the counter now.`, url };
    case 'QUEUE_APPROACHING':
      return (data?.peopleAhead ?? 0) <= env.NOTIFY_NEXT_AT
        ? { title: "You're next", body: `Token #${n}: start making your way to the salon.`, url }
        : { title: "You're getting close", body: `Token #${n}: you're near the front. Time to start heading over.`, url };
    case 'QUEUE_CANCELLED':
      return {
        title: 'Your turn was skipped',
        body: `The salon skipped token #${n}. Please speak to the staff if this looks like a mistake.`,
        url,
      };
  }
}

export class WebPushProvider implements NotificationProvider {
  constructor(keys: { publicKey: string; privateKey: string; subject: string }) {
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  }

  async send(event: NotificationEvent, target: NotificationTarget, data?: { peopleAhead?: number }) {
    logLine(event, target, data); // ids and counts only

    const { data: row, error } = await supabase
      .from('queue_entries')
      .select('push_subscription, access_token')
      .eq('id', target.entryId)
      .maybeSingle();
    if (error) throw error;
    if (!row?.push_subscription) return; // this customer never turned notifications on

    // The payload is end-to-end encrypted to the customer's device, so the access token
    // in the link is not readable by the push service.
    const message = buildPushMessage(event, target, data, row.access_token);
    try {
      await webpush.sendNotification(
        row.push_subscription as webpush.PushSubscription,
        JSON.stringify(message),
        { TTL: 300, urgency: 'high' }, // a "your turn" that arrives 20 minutes late is worse than none
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The browser says this subscription is gone for good.
        await supabase.from('queue_entries').update({ push_subscription: null }).eq('id', target.entryId);
        return;
      }
      throw err;
    }
  }
}

function createProvider(): NotificationProvider {
  if (env.NOTIFICATION_PROVIDER === 'webpush') {
    return new WebPushProvider({
      publicKey: env.VAPID_PUBLIC_KEY!,
      privateKey: env.VAPID_PRIVATE_KEY!,
      subject: env.VAPID_SUBJECT,
    });
  }
  if (env.NOTIFICATION_PROVIDER !== 'console') {
    console.warn(`[notify] Unknown provider "${env.NOTIFICATION_PROVIDER}", using console.`);
  }
  return new ConsoleProvider();
}

let provider: NotificationProvider = createProvider();

export function resetNotificationProvider() {
  provider = createProvider();
}

// For tests: swap in a spy or a specific provider.
export function setNotificationProvider(p: NotificationProvider) {
  provider = p;
}

// A failing provider must never break a queue operation.
async function dispatch(
  event: NotificationEvent,
  target: NotificationTarget,
  data?: { peopleAhead?: number },
) {
  try {
    await provider.send(event, target, data);
  } catch (err) {
    // Name only. Push errors carry the subscription endpoint, which is an identifier.
    const name = err instanceof Error ? err.name : 'Error';
    console.error(`[notify] ${event} failed salon=${target.salonId} token=${target.tokenNumber} (${name})`);
  }
}

export const NotificationService = {
  notifyQueueApproaching: (t: NotificationTarget, peopleAhead: number) =>
    dispatch('QUEUE_APPROACHING', t, { peopleAhead }),
  notifyTurnNow: (t: NotificationTarget) => dispatch('TURN_NOW', t),
  notifyQueueCancelled: (t: NotificationTarget) => dispatch('QUEUE_CANCELLED', t),
};