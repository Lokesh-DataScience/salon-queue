import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import * as webpush from 'web-push';
import { app, makeSalon, cleanupSalons, joinViaApi, plantLegacyPersonalData } from './helpers';
import { joinQueue } from '../src/services/queue.service';
import { callNext, skipEntry } from '../src/services/barber.service';
import { evaluateNotifications } from '../src/services/queueNotifications.service';
import {
  NotificationService,
  WebPushProvider,
  setNotificationProvider,
  resetNotificationProvider,
} from '../src/services/notification.service';
import { supabase } from '../src/config/supabase';

vi.mock('web-push', () => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));

afterAll(async () => {
  resetNotificationProvider();
  await cleanupSalons();
});

const sendMock = vi.mocked(webpush.sendNotification);
const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-1',
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
};
const provider = () =>
  new WebPushProvider({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:test@example.com' });

const put = (id: string, body: unknown) =>
  request(app).put(`/api/queue-tickets/${id}/push-subscription`).send(body as object);
const readSub = async (id: string) =>
  (await supabase.from('queue_entries').select('push_subscription').eq('id', id).single()).data!.push_subscription;
const subscribeInDb = (id: string) =>
  supabase.from('queue_entries').update({ push_subscription: SUB }).eq('id', id);

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
});

describe('Push subscription endpoint', () => {
  it('saves a subscription for the ticket owner', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    const res = await put(t.ticketId, { accessToken: t.accessToken, subscription: SUB });
    expect(res.status).toBe(200);
    expect(await readSub(t.ticketId)).toEqual(SUB);
  });

  it("refuses another ticket's token and a junk token, saving nothing", async () => {
    const salonId = await makeSalon();
    const a = (await joinViaApi(salonId)).body.ticket;
    const b = (await joinViaApi(salonId)).body.ticket;

    expect((await put(a.ticketId, { accessToken: b.accessToken, subscription: SUB })).status).toBe(404);
    expect((await put(a.ticketId, { accessToken: 'x'.repeat(40), subscription: SUB })).status).toBe(404);
    expect(await readSub(a.ticketId)).toBeNull();
  });

  it('refuses endpoints that are not real push services (SSRF)', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    const bad = [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://evil.example.com/push',
      'https://fcm.googleapis.com.evil.example/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
    ];
    for (const endpoint of bad) {
      const res = await put(t.ticketId, { accessToken: t.accessToken, subscription: { ...SUB, endpoint } });
      expect(res.status, endpoint).toBe(400);
    }
    expect(await readSub(t.ticketId)).toBeNull();
  });

  it('accepts the major browsers\' push services', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-pn1p.notify.windows.com/w/?token=abc',
    ]) {
      const res = await put(t.ticketId, { accessToken: t.accessToken, subscription: { ...SUB, endpoint } });
      expect(res.status, endpoint).toBe(200);
    }
  });

  it('can be removed, only by the owner', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    await put(t.ticketId, { accessToken: t.accessToken, subscription: SUB });

    const wrong = await request(app)
      .delete(`/api/queue-tickets/${t.ticketId}/push-subscription`)
      .send({ accessToken: 'x'.repeat(40) });
    expect(wrong.status).toBe(404);
    expect(await readSub(t.ticketId)).toEqual(SUB);

    const ok = await request(app)
      .delete(`/api/queue-tickets/${t.ticketId}/push-subscription`)
      .send({ accessToken: t.accessToken });
    expect(ok.status).toBe(200);
    expect(await readSub(t.ticketId)).toBeNull();
  });

  it('refuses a subscription for a ticket that is already finished', async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    await skipEntry(salonId, t.ticketId);
    const res = await put(t.ticketId, { accessToken: t.accessToken, subscription: SUB });
    expect(res.status).toBe(404);
  });

  it('reports push as disabled when the provider is not webpush', async () => {
    const res = await request(app).get('/api/push-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, publicKey: null });
  });
    it('ticket status reports whether notifications are on, without leaking the subscription', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    const get = () => request(app).get(`/api/queue-tickets/${t.ticketId}`).query({ accessToken: t.accessToken });

    expect((await get()).body.ticket.notificationsOn).toBe(false);
    await put(t.ticketId, { accessToken: t.accessToken, subscription: SUB });
    const after = await get();
    expect(after.body.ticket.notificationsOn).toBe(true);
    expect(JSON.stringify(after.body)).not.toContain('fcm.googleapis.com');
  });
});

describe('WebPushProvider', () => {
  it('sends a message whose link carries the ticket token, and no personal details', async () => {
    const salonId = await makeSalon();
    const NAME = 'Zephyr Quillfeather';
    const PHONE = '9123450077';
    const t = await joinQueue(salonId);
    await plantLegacyPersonalData(t.ticketId, NAME, PHONE);
    await subscribeInDb(t.ticketId);

    await provider().send('TURN_NOW', { entryId: t.ticketId, salonId, tokenNumber: t.tokenNumber });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [sub, payload, options] = sendMock.mock.calls[0];
    expect(sub).toEqual(SUB);
    const msg = JSON.parse(payload as string);
    expect(msg.title).toBe("It's your turn");
    expect(msg.url).toBe(`/tickets/${t.ticketId}?accessToken=${t.accessToken}`);
    expect(payload as string).not.toContain(NAME);
    expect(payload as string).not.toContain(PHONE);
    expect(options).toMatchObject({ TTL: 300 });
  });

  it('does nothing for a customer who never enabled notifications', async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    await provider().send('TURN_NOW', { entryId: t.ticketId, salonId, tokenNumber: t.tokenNumber });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('forgets a subscription the browser reports as gone (410)', async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    await subscribeInDb(t.ticketId);
    sendMock.mockRejectedValue(Object.assign(new Error('gone'), { name: 'WebPushError', statusCode: 410 }));

    await expect(
      provider().send('TURN_NOW', { entryId: t.ticketId, salonId, tokenNumber: t.tokenNumber }),
    ).resolves.toBeUndefined();
    expect(await readSub(t.ticketId)).toBeNull();
  });

  it('a push failure never breaks the queue and never logs the endpoint', async () => {
    setNotificationProvider(provider());
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    await subscribeInDb(t.ticketId);
    sendMock.mockRejectedValue(
      Object.assign(new Error('boom'), { name: 'WebPushError', statusCode: 500, endpoint: SUB.endpoint }),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      NotificationService.notifyTurnNow({ entryId: t.ticketId, salonId, tokenNumber: t.tokenNumber }),
    ).resolves.toBeUndefined();

    const output = errSpy.mock.calls.map((a) => a.map(String).join(' ')).join('\n');
    errSpy.mockRestore();
    expect(output).toContain('[notify]');
    expect(output).not.toContain('fcm.googleapis.com');
  });

  it('end to end: calling the customer pushes "It\'s your turn" exactly once', async () => {
    setNotificationProvider(provider());
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    await evaluateNotifications(salonId, { silentEntryId: t.ticketId });
    await subscribeInDb(t.ticketId);

    await callNext(salonId);
    await evaluateNotifications(salonId);
    await evaluateNotifications(salonId); // a repeat must not send again

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sendMock.mock.calls[0][1] as string).title).toBe("It's your turn");
  });
});

describe('Cleanup erases push subscriptions of finished tickets', () => {
  it('nulls them for finished entries and keeps active ones', async () => {
    const salonId = await makeSalon();
    const finished = await joinQueue(salonId);
    const active = await joinQueue(salonId);
    await subscribeInDb(finished.ticketId);
    await subscribeInDb(active.ticketId);
    await supabase
      .from('queue_entries')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
      .eq('id', finished.ticketId);

    const { error } = await supabase.rpc('cleanup_customer_data', { p_retention_hours: 24 });
    expect(error).toBeNull();

    expect(await readSub(finished.ticketId)).toBeNull();
    expect(await readSub(active.ticketId)).toEqual(SUB);
  });
});