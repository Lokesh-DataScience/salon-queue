// frontend/src/lib/push.ts
import { apiFetch } from '../api/client';

export type PushSupport = 'ok' | 'ios-install' | 'unsupported';

export function pushSupport(): PushSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok';
  // iPhones only expose push to sites added to the Home Screen.
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios ? 'ios-install' : 'unsupported';
}

export function fetchPushConfig() {
  return apiFetch<{ enabled: boolean; publicKey: string | null }>('/api/push-config');
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Must be called straight from a click: browsers only show the permission prompt for a user gesture,
// so the prompt comes BEFORE any network call.
export async function enablePush(
  ticketId: string,
  accessToken: string,
  publicKey: string,
): Promise<'enabled' | 'denied'> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  await navigator.serviceWorker.register('/sw.js');
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await apiFetch(`/api/queue-tickets/${ticketId}/push-subscription`, {
    method: 'PUT',
    body: JSON.stringify({ accessToken, subscription: subscription.toJSON() }),
  });
  return 'enabled';
}

// Only detaches this ticket on the server. The browser subscription stays, because the same
// device may be tracking another ticket.
export async function disablePush(ticketId: string, accessToken: string) {
  await apiFetch(`/api/queue-tickets/${ticketId}/push-subscription`, {
    method: 'DELETE',
    body: JSON.stringify({ accessToken }),
  });
}

// Call straight from a tap, before any await: browsers only show the prompt for a user gesture.
export function askPushPermission(): Promise<'granted' | 'skip'> {
  if (pushSupport() !== 'ok') return Promise.resolve('skip');
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  if (Notification.permission === 'denied') return Promise.resolve('skip');
  return Notification.requestPermission()
    .then((p): 'granted' | 'skip' => (p === 'granted' ? 'granted' : 'skip'))
    .catch((): 'skip' => 'skip');
}

export async function enablePushAfterJoin(ticketId: string, accessToken: string) {
  const config = await fetchPushConfig();
  if (!config.enabled || !config.publicKey) return;
  await enablePush(ticketId, accessToken, config.publicKey);
}

// "Send a test notification": the server pushes a test to the subscription saved on this ticket.
// Throws ApiError with code NO_SUBSCRIPTION / TOO_SOON / EXPIRED / PUSH_DISABLED when it can't.
export function sendTestPush(ticketId: string, accessToken: string, lang: 'hi' | 'en') {
  return apiFetch<{ ok: boolean }>(`/api/queue-tickets/${ticketId}/test-push`, {
    method: 'POST',
    body: JSON.stringify({ accessToken, lang }),
  });
}
