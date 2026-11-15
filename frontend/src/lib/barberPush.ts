// frontend/src/lib/barberPush.ts
// Barber "New token" alerts on this phone. Separate from customer ticket pushes:
// the server stores this device against the signed-in staff member, not a ticket.
import { apiFetch } from '../api/client';
import { pushSupport, fetchPushConfig, urlBase64ToUint8Array } from './push';

// Device-level "the barber turned alerts on here". No personal data, just on/off.
const FLAG = 'svq.barberAlerts';

export type BarberAlertsState = 'unsupported' | 'ios-install' | 'unavailable' | 'blocked' | 'off' | 'on';

function readFlag() {
  try {
    return localStorage.getItem(FLAG) === 'on';
  } catch {
    return false;
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, 'on');
    else localStorage.removeItem(FLAG);
  } catch {
    /* private mode: the switch just shows "off" next time */
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

function saveOnServer(sub: PushSubscription) {
  return apiFetch<{ ok: boolean }>('/api/barber/push-subscription', {
    method: 'PUT',
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
}

// What the switch should show. If alerts are on, also re-saves this phone on the server
// (keeps it fresh, and re-attaches it if the server dropped it).
export async function getBarberAlertsState(): Promise<BarberAlertsState> {
  const support = pushSupport();
  if (support === 'ios-install') return 'ios-install';
  if (support !== 'ok') return 'unsupported';

  const config = await fetchPushConfig().catch(() => null);
  if (!config?.enabled || !config.publicKey) return 'unavailable';

  if (Notification.permission === 'denied') {
    writeFlag(false);
    return 'blocked';
  }
  if (!readFlag() || Notification.permission !== 'granted') {
    writeFlag(false);
    return 'off';
  }
  const sub = await currentSubscription().catch(() => null);
  if (!sub) {
    writeFlag(false);
    return 'off';
  }
  await saveOnServer(sub).catch(() => {}); // a network blip must not flip the switch off
  return 'on';
}

// Call straight from the tap: the permission prompt only appears for a user gesture,
// so it comes BEFORE any network call.
export async function enableBarberAlerts(): Promise<'on' | 'blocked' | 'dismissed'> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'dismissed';

  const config = await fetchPushConfig();
  if (!config.enabled || !config.publicKey) throw new Error('Notifications are not available right now.');

  await navigator.serviceWorker.register('/sw.js');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    }));

  await saveOnServer(sub);
  writeFlag(true);
  return 'on';
}

// Removes this phone from the server. The browser subscription stays: the same phone
// may also be tracking a customer ticket.
export async function disableBarberAlerts() {
  writeFlag(false);
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await apiFetch<{ ok: boolean }>('/api/barber/push-subscription', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
}

// Throws ApiError with code NO_SUBSCRIPTION / TOO_SOON / FAILED / PUSH_DISABLED when it can't.
export function sendBarberTestAlert() {
  return apiFetch<{ ok: boolean; sent: number }>('/api/barber/push-subscription/test', { method: 'POST' });
}
