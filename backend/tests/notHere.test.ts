// backend/tests/notHere.test.ts — Customer app, Slice 2: the barber's "Not here" button.
// Needs step14_customer_app.sql and step15_not_here.sql applied to the tests project.
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, barberCookieFor, joinViaApi } from './helpers';
import { supabase } from '../src/config/supabase';
import { setNotificationProvider, resetNotificationProvider } from '../src/services/notification.service';
import { compareServeOrder } from '../src/utils/serveOrder';

afterAll(async () => {
  resetNotificationProvider();
  await cleanupSalons();
});

const sent: { event: string; token: number }[] = [];
beforeEach(() => {
  sent.length = 0;
  setNotificationProvider({ send: async (event, target) => void sent.push({ event, token: target.tokenNumber }) });
});

type Ticket = { ticketId: string; accessToken: string; tokenNumber: number };

async function joinOk(salonId: string, source: 'qr' | 'app' = 'qr'): Promise<Ticket> {
  const res = await joinViaApi(salonId, { source });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.ticket as Ticket;
}

// Tokens in serve order, e.g. "1S 3W 2W" (S = serving, C = called, W = waiting), straight from the dashboard.
async function line(cookie: string) {
  const s = (await request(app).get('/api/barber/queue').set('Cookie', cookie)).body;
  const tag = (e: { token_number: number; status: string }) => `${e.token_number}${e.status[0]}`;
  return [s.serving, s.called, ...s.waiting].filter(Boolean).map(tag).join(' ');
}

const notHere = (cookie: string, id: string) =>
  request(app).post(`/api/barber/queue/${id}/not-here`).set('Cookie', cookie);
const complete = (cookie: string, id: string) =>
  request(app).post(`/api/barber/queue/${id}/complete`).set('Cookie', cookie);

async function servingId(cookie: string) {
  return (await request(app).get('/api/barber/queue').set('Cookie', cookie)).body.serving.id as string;
}

describe('"Not here" (Customer app Slice 2)', () => {
  it('first time: back behind the next two, the next customer starts, the customer is told', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    const a = await joinOk(salonId, 'app'); // #1 starts at once
    for (let i = 0; i < 3; i++) await joinOk(salonId); // #2 #3 #4
    expect(await line(cookie)).toBe('1S 2W 3W 4W');

    const res = await notHere(cookie, a.ticketId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.entry).toMatchObject({ action: 'moved_back', tokenNumber: 1 });
    expect(await line(cookie)).toBe('2S 3W 1W 4W');
    expect(sent).toContainEqual({ event: 'MOVED_BACK', token: 1 });

    // The customer's own ticket agrees: waiting again, one person waiting ahead (#3), #2 at the chair.
    const t = (await request(app).get(`/api/queue-tickets/${a.ticketId}`).set('X-Ticket-Token', a.accessToken)).body.ticket;
    expect(t.status).toBe('WAITING');
    expect(t.peopleAhead).toBe(1);

    const { data } = await supabase.from('queue_entries').select('started_at, ends_at, not_here_count').eq('id', a.ticketId).single();
    expect(data).toMatchObject({ started_at: null, ends_at: null, not_here_count: 1 });
  }, 90_000);

  it('second time at the chair and still not here: the ticket is cancelled', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    const a = await joinOk(salonId, 'app');
    await joinOk(salonId); // #2
    await joinOk(salonId); // #3
    await notHere(cookie, a.ticketId); // 2S 3W 1W
    await complete(cookie, await servingId(cookie)); // 3S 1W
    await complete(cookie, await servingId(cookie)); // 1S
    expect(await line(cookie)).toBe('1S');

    sent.length = 0;
    const res = await notHere(cookie, a.ticketId);
    expect(res.body.entry.action).toBe('cancelled');
    expect(await line(cookie)).toBe('');
    expect(sent).toContainEqual({ event: 'QUEUE_CANCELLED', token: 1 });
    const { data } = await supabase.from('queue_entries').select('status, cancelled_at').eq('id', a.ticketId).single();
    expect(data!.status).toBe('CANCELLED');
    expect(data!.cancelled_at).not.toBeNull();
  }, 90_000);

  it('only one other customer waiting: goes behind them; nobody else waiting: cancelled at once', async () => {
    const s1 = await makeSalon();
    const c1 = await barberCookieFor(s1);
    const a = await joinOk(s1, 'app');
    await joinOk(s1);
    expect((await notHere(c1, a.ticketId)).body.entry.action).toBe('moved_back');
    expect(await line(c1)).toBe('2S 1W');

    const s2 = await makeSalon();
    const c2 = await barberCookieFor(s2);
    const b = await joinOk(s2, 'app');
    expect((await notHere(c2, b.ticketId)).body.entry.action).toBe('cancelled');
    expect(await line(c2)).toBe('');
  }, 90_000);

  it('respects emergency bumps: goes behind the second person in line, whoever that is', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    const a = await joinOk(salonId, 'app');
    for (let i = 0; i < 4; i++) await joinOk(salonId); // #2..#5
    const five = (await request(app).get('/api/barber/queue').set('Cookie', cookie)).body.waiting
      .find((e: { token_number: number }) => e.token_number === 5).id;
    expect((await request(app).post(`/api/barber/queue/${five}/prioritize`).set('Cookie', cookie)).status).toBe(200);
    expect(await line(cookie)).toBe('1S 5W 2W 3W 4W');

    await notHere(cookie, a.ticketId);
    expect(await line(cookie)).toBe('5S 2W 1W 3W 4W');
  }, 90_000);

  it('refuses QR customers, waiting customers, another salon and a signed-out caller', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    const qr = await joinOk(salonId); // at the chair, but scanned the wall QR
    const waitingApp = await joinOk(salonId, 'app');

    const r1 = await notHere(cookie, qr.ticketId);
    expect(r1.status).toBe(409);
    expect(r1.body.message).toMatch(/Skip/);
    expect((await notHere(cookie, waitingApp.ticketId)).status).toBe(409); // not at the chair yet

    const other = await barberCookieFor(await makeSalon());
    expect((await notHere(other, qr.ticketId)).status).toBe(404);
    expect((await notHere(cookie, randomUUID())).status).toBe(404);
    expect((await request(app).post(`/api/barber/queue/${qr.ticketId}/not-here`)).status).toBe(401);

    expect(await line(cookie)).toBe('1S 2W'); // nothing moved
  }, 90_000);

  it('a double tap moves the customer back once', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    const a = await joinOk(salonId, 'app');
    for (let i = 0; i < 3; i++) await joinOk(salonId);

    const [x, y] = await Promise.all([notHere(cookie, a.ticketId), notHere(cookie, a.ticketId)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await line(cookie)).toBe('2S 3W 1W 4W');
    const { data } = await supabase.from('queue_entries').select('not_here_count').eq('id', a.ticketId).single();
    expect(data!.not_here_count).toBe(1);
  }, 90_000);

  it('the dashboard tells the barber who joined from the app and how many times they were not here', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    const a = await joinOk(salonId, 'app');
    await joinOk(salonId);
    await joinOk(salonId);
    await notHere(cookie, a.ticketId);

    const snap = (await request(app).get('/api/barber/queue').set('Cookie', cookie)).body;
    expect(snap.serving).toMatchObject({ join_source: 'qr', not_here_count: 0 });
    const back = snap.waiting.find((e: { id: string }) => e.id === a.ticketId);
    expect(back).toMatchObject({ join_source: 'app', not_here_count: 1 });
  }, 90_000);
});

describe('serve order with a moved-back customer (no database)', () => {
  const e = (token: number, extra: Record<string, unknown> = {}) => ({ token_number: token, status: 'WAITING', priority_at: null, ...extra });
  const order = (list: ReturnType<typeof e>[]) => [...list].sort(compareServeOrder).map((x) => x.token_number);

  it('a moved-back ticket sits between its neighbours; everyone else keeps token order', () => {
    expect(order([e(1, { order_key: '3.5' }), e(3), e(4), e(5)])).toEqual([3, 1, 4, 5]);
  });

  it('emergency bumps still come first', () => {
    expect(order([e(1, { order_key: 3.5 }), e(3), e(4), e(9, { priority_at: '2026-01-01T10:00:00Z' })])).toEqual([9, 3, 1, 4]);
  });
});
