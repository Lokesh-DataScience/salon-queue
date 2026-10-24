import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enablePush, disablePush, pushSupport } from './push';
import { apiFetch } from '../api/client';

vi.mock('../api/client', () => ({ apiFetch: vi.fn() }));

const subscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }) };
const pushManager = { getSubscription: vi.fn(), subscribe: vi.fn() };
const requestPermission = vi.fn();

function installBrowser() {
  vi.stubGlobal('Notification', { requestPermission, permission: 'default' });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue({}), ready: Promise.resolve({ pushManager }) },
  });
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  pushManager.getSubscription.mockReset().mockResolvedValue(null);
  pushManager.subscribe.mockReset().mockResolvedValue(subscription);
  requestPermission.mockReset().mockResolvedValue('granted');
  installBrowser();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe('enablePush', () => {
  it('asks permission, subscribes, and registers the subscription with the ticket', async () => {
    const result = await enablePush('t1', 'tok'.repeat(12), 'AQAB');

    expect(result).toBe('enabled');
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
    );
    const [path, init] = vi.mocked(apiFetch).mock.calls[0];
    expect(path).toBe('/api/queue-tickets/t1/push-subscription');
    expect(init).toMatchObject({ method: 'PUT' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.accessToken).toBe('tok'.repeat(12));
    expect(body.subscription.endpoint).toBe('https://fcm.googleapis.com/x');
  });

  it('does nothing further when the customer says no', async () => {
    requestPermission.mockResolvedValue('denied');
    await expect(enablePush('t1', 'tok', 'AQAB')).resolves.toBe('denied');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('reuses an existing browser subscription instead of creating another', async () => {
    pushManager.getSubscription.mockResolvedValue(subscription);
    await enablePush('t1', 'tok', 'AQAB');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('disablePush', () => {
  it('detaches the ticket on the server', async () => {
    await disablePush('t1', 'tok');
    const [path, init] = vi.mocked(apiFetch).mock.calls[0];
    expect(path).toBe('/api/queue-tickets/t1/push-subscription');
    expect(init).toMatchObject({ method: 'DELETE' });
  });
});

describe('pushSupport', () => {
  it('is unsupported where the browser has no push APIs', () => {
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    expect(pushSupport()).toBe('unsupported');
  });

  it('points iPhone visitors to the Home Screen route', () => {
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(pushSupport()).toBe('ios-install');
  });
});