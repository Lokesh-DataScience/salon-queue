// backend/tests/testPush.test.ts — customer app polish 3a: "Send a test notification".
// web-push is replaced with a fake, so nothing is really sent.
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';
import * as webpush from 'web-push';
import { app, makeSalon, cleanupSalons, joinViaApi, plantLegacyPersonalData } from './helpers';
import { joinQueue } from '../src/services/queue.service';
import { skipEntry } from '../src/services/barber.service';
import { resetTestPushCooldown } from '../src/services/testPush.service';
import { env } from '../src/config/env';
import { supabase } from '../src/config/supabase';

vi.mock('web-push', () => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));

const sendMock = vi.mocked(webpush.sendNotification);
const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-2',
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
};
const realProvider = env.NOTIFICATION_PROVIDER;
const setProvider = (p: string) => {
  (env as { NOTIFICATION_PROVIDER: string }).NOTIFICATION_PROVIDER = p;
};

const test = (id: string, body: object) => request(app).post(`/api/queue-tickets/${id}/test-push`).send(body);
const subscribeInDb = (id: string) => supabase.from('queue_entries').update({ push_subscription: SUB }).eq('id', id);
const readSub = async (id: string) =>
  (await supabase.from('queue_entries').select('push_subscription').eq('id', id).single()).data!.push_subscription;

beforeEach(() => {
  setProvider('webpush');
  resetTestPushCooldown();
  sendMock.mockReset();
  sendMock.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
});
afterEach(() => setProvider(realProvider));
afterAll(cleanupSalons);

describe('POST /api/queue-tickets/:id/test-push', () => {
  it('sends a Hindi test to the ticket owner, with the ticket link and no personal details', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    await plantLegacyPersonalData(t.ticketId, 'Zephyr Quillfeather', '9123450077');
    await subscribeInDb(t.ticketId);

    const res = await test(t.ticketId, { accessToken: t.accessToken });
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [sub, payload] = sendMock.mock.calls[0];
    expect(sub).toEqual(SUB);
    const msg = JSON.parse(payload as string);
    expect(msg.title).toBe('टेस्ट सूचना');
    expect(msg.body).toContain(`#${t.tokenNumber}`);
    expect(msg.url).toBe(`/tickets/${t.ticketId}?accessToken=${t.accessToken}`);
    expect(payload as string).not.toContain('Zephyr');
    expect(payload as string).not.toContain('9123450077');
  });

  it('speaks English when asked', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    await subscribeInDb(t.ticketId);
    await test(t.ticketId, { accessToken: t.accessToken, lang: 'en' });
    expect(JSON.parse(sendMock.mock.calls[0][1] as string).title).toBe('Test notification');
  });

  it("refuses another ticket's token, a junk token and a finished ticket, sending nothing", async () => {
    const salonId = await makeSalon();
    const a = (await joinViaApi(salonId)).body.ticket;
    const b = (await joinViaApi(salonId)).body.ticket;
    await subscribeInDb(a.ticketId);
    expect((await test(a.ticketId, { accessToken: b.accessToken })).status).toBe(404);
    expect((await test(a.ticketId, { accessToken: 'x'.repeat(40) })).status).toBe(404);

    const done = await joinQueue(salonId);
    await subscribeInDb(done.ticketId);
    await skipEntry(salonId, done.ticketId);
    expect((await test(done.ticketId, { accessToken: done.accessToken })).status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('says so when notifications were never turned on for this ticket', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    const res = await test(t.ticketId, { accessToken: t.accessToken });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_SUBSCRIPTION');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('says so when the server has push switched off', async () => {
    setProvider('console');
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    await subscribeInDb(t.ticketId);
    const res = await test(t.ticketId, { accessToken: t.accessToken });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PUSH_DISABLED');
  });

  it('allows one test per 30 seconds per ticket', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    await subscribeInDb(t.ticketId);
    expect((await test(t.ticketId, { accessToken: t.accessToken })).status).toBe(200);
    const again = await test(t.ticketId, { accessToken: t.accessToken });
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('TOO_SOON');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('forgets a subscription the browser reports as gone, and tells the page', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    await subscribeInDb(t.ticketId);
    sendMock.mockRejectedValue(Object.assign(new Error('gone'), { name: 'WebPushError', statusCode: 410 }));
    const res = await test(t.ticketId, { accessToken: t.accessToken });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('EXPIRED');
    expect(await readSub(t.ticketId)).toBeNull();
  });

  it('a push service failure is a clean error that never logs the endpoint', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    await subscribeInDb(t.ticketId);
    sendMock.mockRejectedValue(Object.assign(new Error(`boom ${SUB.endpoint}`), { name: 'WebPushError', statusCode: 500 }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await test(t.ticketId, { accessToken: t.accessToken });
    const output = errSpy.mock.calls.map((a) => a.map(String).join(' ')).join('\n');
    errSpy.mockRestore();
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('fcm.googleapis.com');
    expect(output).not.toContain('fcm.googleapis.com');
  });
});
