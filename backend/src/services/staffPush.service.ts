// backend/src/services/staffPush.service.ts
// Barber notifications: "New token #14 — Rahul (QR scan / app)" on every signed-up device of the salon's
// ACTIVE staff. Walk-ins (+1) never alert: the barber added them himself.
//
// Rules, same as customer pushes:
//  - a failing push never breaks a join (every public function here catches and logs),
//  - logs carry ids only: never names, phones or push endpoints,
//  - the customer's phone number is never put in a notification.
import * as webpush from 'web-push';
import { env } from '../config/env';
import { supabase } from '../config/supabase';

const MAX_DEVICES_PER_STAFF = 5;
const TEST_COOLDOWN_MS = 30_000;
const MAX_TRACKED = 5_000;

export interface StaffPushMessage {
  title: string;
  body: string;
  url: string;
  tag: string; // one notification per token: several joins stack instead of replacing each other
}

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// ── Message ───────────────────────────────────────────────────────────────

export function buildNewTokenMessage(input: {
  entryId: string;
  tokenNumber: number;
  name: string | null;
  source: string;
}): StaffPushMessage {
  const who = input.name?.trim() || 'A customer';
  const how =
    input.source === 'app'
      ? 'took a token from the app (may still be at home)'
      : 'scanned the QR at the salon';
  return {
    title: `New token #${input.tokenNumber} (नया टोकन)`,
    body: `${who} ${how}.`,
    url: '/barber/dashboard',
    tag: `new-token-${input.entryId}`,
  };
}

export function buildStaffTestMessage(): StaffPushMessage {
  return {
    title: 'Test alert (टेस्ट)',
    body: 'New-customer alerts are working on this phone.',
    url: '/barber/dashboard',
    tag: 'staff-test',
  };
}

// ── Sender (swappable for tests) ──────────────────────────────────────────

export type StaffPushSender = (subscription: StoredSubscription, payload: string) => Promise<void>;

const webPushSender: StaffPushSender = async (subscription, payload) => {
  await webpush.sendNotification(subscription as webpush.PushSubscription, payload, {
    TTL: 600, // a "new customer" alert 10+ minutes late is noise
    urgency: 'high',
    vapidDetails: {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY!,
      privateKey: env.VAPID_PRIVATE_KEY!,
    },
  });
};

function defaultSender(): StaffPushSender | null {
  return env.NOTIFICATION_PROVIDER === 'webpush' && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? webPushSender
    : null; // console mode (dev/tests): log only
}

let sender: StaffPushSender | null = defaultSender();

export function setStaffPushSender(s: StaffPushSender | null) {
  sender = s;
}
export function resetStaffPushSender() {
  sender = defaultSender();
}

const errName = (err: unknown) => {
  const status = (err as { statusCode?: number }).statusCode;
  return status ? `HTTP_${status}` : err instanceof Error ? err.name : 'Error';
};

// Sends to each row. Rows the push service says are gone (404/410) are deleted. Returns how many were accepted.
async function sendToRows(rows: { id: string; subscription: unknown }[], message: StaffPushMessage) {
  if (!sender || rows.length === 0) return 0;
  const send = sender;
  const payload = JSON.stringify(message);
  const results = await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await send(row.subscription as StoredSubscription, payload);
        return true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase.from('staff_push_subscriptions').delete().eq('id', row.id);
          return false;
        }
        console.error(`[staff-notify] send failed sub=${row.id} (${errName(err)})`); // id only, never the endpoint
        return false;
      }
    }),
  );
  return results.filter((r) => r.status === 'fulfilled' && r.value).length;
}

// ── Subscriptions ─────────────────────────────────────────────────────────

export async function saveStaffSubscription(
  who: { staffId: string; salonId: string },
  subscription: StoredSubscription,
) {
  const { error } = await supabase.from('staff_push_subscriptions').upsert(
    {
      staff_id: who.staffId,
      salon_id: who.salonId,
      endpoint: subscription.endpoint,
      subscription,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }, // same phone, new login: the row moves to this staff member
  );
  if (error) throw error;

  // Keep only the newest few devices per person (old phones, reinstalls).
  const { data: extra } = await supabase
    .from('staff_push_subscriptions')
    .select('id')
    .eq('staff_id', who.staffId)
    .order('last_seen_at', { ascending: false })
    .range(MAX_DEVICES_PER_STAFF, MAX_DEVICES_PER_STAFF + 50);
  if (extra && extra.length > 0) {
    await supabase.from('staff_push_subscriptions').delete().in('id', extra.map((r) => r.id));
  }
}

// Only this staff member's own row for that device. Returns false if nothing matched.
export async function removeStaffSubscription(staffId: string, endpoint: string) {
  const { data, error } = await supabase
    .from('staff_push_subscriptions')
    .delete()
    .eq('staff_id', staffId)
    .eq('endpoint', endpoint)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

// ── New token ────────────────────────────────────────────────────────────

// Called after a customer joins (wall QR or customer app). Never throws. Returns devices alerted.
export async function notifyStaffNewToken(salonId: string, entryId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('queue_entries')
      .select('id, token_number, join_source, is_walk_in, salon_customers(name), queues!inner(salon_id)')
      .eq('id', entryId)
      .maybeSingle();
    if (error) throw error;

    const entry = data as unknown as {
      id: string;
      token_number: number;
      join_source: string | null;
      is_walk_in: boolean | null;
      salon_customers: { name: string } | null;
      queues: { salon_id: string };
    } | null;
    if (!entry || entry.queues.salon_id !== salonId || entry.is_walk_in) return 0;

    if (!sender) {
      console.log(`[staff-notify] NEW_TOKEN salon=${salonId} token=${entry.token_number} (push off)`);
      return 0;
    }

    const { data: rows, error: subErr } = await supabase
      .from('staff_push_subscriptions')
      .select('id, subscription, salon_staff!inner(is_active)')
      .eq('salon_id', salonId)
      .eq('salon_staff.is_active', true);
    if (subErr) throw subErr;
    if (!rows || rows.length === 0) return 0;

    const message = buildNewTokenMessage({
      entryId: entry.id,
      tokenNumber: entry.token_number,
      name: entry.salon_customers?.name ?? null,
      source: entry.join_source ?? 'qr',
    });
    const sent = await sendToRows(rows, message);
    console.log(`[staff-notify] NEW_TOKEN salon=${salonId} token=${entry.token_number} devices=${sent}/${rows.length}`);
    return sent;
  } catch (err) {
    console.error(`[staff-notify] NEW_TOKEN failed salon=${salonId} (${errName(err)})`);
    return 0;
  }
}

// ── Shop (Commerce C5a, §15) ─────────────────────────────────────────────
// Payloads carry the order number and an admin link only: never a name, phone, address, cost or profit.

const shopOrderUrl = (orderId: string) => `/barber/admin?tab=shop&view=orders&order=${orderId}`;

export function buildShopNewOrderMessage(orderId: string, orderNumber: string): StaffPushMessage {
  return { title: `New shop order ${orderNumber} (नया ऑर्डर)`, body: 'Open the Shop tab to confirm it with the supplier.', url: shopOrderUrl(orderId), tag: `shop-order-${orderId}` };
}

export function buildShopReminderMessage(orderId: string, orderNumber: string): StaffPushMessage {
  return { title: `Order ${orderNumber} is waiting for your action`, body: 'It is still "Placed". Contact the supplier or call the customer.', url: shopOrderUrl(orderId), tag: `shop-reminder-${orderId}` };
}

// Every device of the given ACTIVE staff members (whatever salon they belong to). Never throws.
export async function notifyStaffIds(staffIds: string[], message: StaffPushMessage, what: string): Promise<number> {
  try {
    if (staffIds.length === 0) return 0;
    if (!sender) {
      console.log(`[staff-notify] ${what} staff=${staffIds.length} (push off)`);
      return 0;
    }
    const { data: rows, error } = await supabase
      .from('staff_push_subscriptions')
      .select('id, subscription, salon_staff!inner(is_active)')
      .in('staff_id', staffIds)
      .eq('salon_staff.is_active', true);
    if (error) throw error;
    const sent = await sendToRows(rows ?? [], message);
    console.log(`[staff-notify] ${what} devices=${sent}/${rows?.length ?? 0}`);
    return sent;
  } catch (err) {
    console.error(`[staff-notify] ${what} failed (${errName(err)})`);
    return 0;
  }
}

// FOUNDER and COFOUNDER for new orders (D18); FOUNDER only for reminders (the cofounder can't act).
export async function shopStaffIds(roles: ('FOUNDER' | 'COFOUNDER')[]): Promise<string[]> {
  const { data, error } = await supabase.from('staff_admin_roles').select('staff_id').in('role', roles);
  if (error) throw error;
  return (data ?? []).map((r) => r.staff_id as string);
}

export async function notifyShopNewOrder(orderId: string, orderNumber: string) {
  try {
    return await notifyStaffIds(await shopStaffIds(['FOUNDER', 'COFOUNDER']), buildShopNewOrderMessage(orderId, orderNumber), `SHOP_NEW_ORDER ${orderNumber}`);
  } catch (err) {
    console.error(`[staff-notify] SHOP_NEW_ORDER failed (${errName(err)})`);
    return 0;
  }
}

// ── Test alert (from Settings) ───────────────────────────────────────────

const lastTest = new Map<string, number>(); // staffId -> last test. In memory: a restart resets it.

export type StaffTestResult =
  | { ok: true; sent: number }
  | { ok: false; reason: 'PUSH_DISABLED' | 'NO_SUBSCRIPTION' | 'TOO_SOON' | 'FAILED' };

export async function sendStaffTestPush(staffId: string): Promise<StaffTestResult> {
  if (!sender) return { ok: false, reason: 'PUSH_DISABLED' };

  const { data: rows, error } = await supabase
    .from('staff_push_subscriptions')
    .select('id, subscription')
    .eq('staff_id', staffId);
  if (error) throw error;
  if (!rows || rows.length === 0) return { ok: false, reason: 'NO_SUBSCRIPTION' };

  const now = Date.now();
  const last = lastTest.get(staffId);
  if (last !== undefined && now - last < TEST_COOLDOWN_MS) return { ok: false, reason: 'TOO_SOON' };
  if (lastTest.size >= MAX_TRACKED) lastTest.clear();
  lastTest.set(staffId, now);

  const sent = await sendToRows(rows, buildStaffTestMessage());
  return sent > 0 ? { ok: true, sent } : { ok: false, reason: 'FAILED' };
}

// Tests only.
export function resetStaffTestCooldown() {
  lastTest.clear();
}
