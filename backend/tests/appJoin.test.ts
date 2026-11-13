// backend/tests/appJoin.test.ts — Customer app, Slice 1: joining from the app.
// Needs step14_customer_app.sql applied to the tests project.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor, customerDetails } from './helpers';
import { supabase } from '../src/config/supabase';
import { joinQueueBodySchema } from '../src/validators/queue.validators';
import { updateSalonProfileBodySchema } from '../src/validators/salonProfile.validators';

afterAll(cleanupSalons);

type Ticket = { ticketId: string; accessToken: string; tokenNumber: number; existing: boolean; rememberToken?: string };

const join = (salonId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/queues/${salonId}/join`).send(body);

async function joinOk(salonId: string, body: Record<string, unknown>): Promise<Ticket> {
  const res = await join(salonId, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.ticket as Ticket;
}

async function sourceOf(ticketId: string) {
  const { data } = await supabase.from('queue_entries').select('join_source').eq('id', ticketId).single();
  return data!.join_source as string;
}

async function ticketCount(salonId: string) {
  const { data } = await supabase.from('queue_entries').select('id, queues!inner(salon_id)').eq('queues.salon_id', salonId);
  return (data ?? []).length;
}

const setAppJoin = (cookie: string, allowAppJoin: unknown) =>
  request(app).patch('/api/barber/salon').set('Cookie', cookie).send({ allowAppJoin });

describe('Joining from the app (Customer app Slice 1)', () => {
  it('records where the ticket came from: app, or qr by default', async () => {
    const salonId = await makeSalon();
    const fromApp = await joinOk(salonId, { ...customerDetails(), source: 'app' });
    const fromQr = await joinOk(salonId, customerDetails());
    expect(fromApp.existing).toBe(false);
    expect(await sourceOf(fromApp.ticketId)).toBe('app');
    expect(await sourceOf(fromQr.ticketId)).toBe('qr');

    const cookie = await barberCookieFor(salonId);
    const walk = await request(app).post('/api/barber/queue/walk-in').set('Cookie', cookie);
    expect(walk.status).toBe(201);
    expect(await sourceOf(walk.body.entry.id)).toBe('qr'); // walk-ins keep is_walk_in; source stays the default
  }, 60_000);

  it('the barber can switch app joins off and on; the wall QR keeps working', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);

    const before = await request(app).get('/api/barber/salon').set('Cookie', cookie);
    expect(before.body.salon.allowAppJoin).toBe(true); // on by default

    const off = await setAppJoin(cookie, false);
    expect(off.status).toBe(200);
    expect(off.body.salon.allowAppJoin).toBe(false);

    const refused = await join(salonId, { ...customerDetails(), source: 'app' });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('APP_JOIN_DISABLED');
    expect(await ticketCount(salonId)).toBe(0);

    expect((await join(salonId, customerDetails())).status).toBe(201); // QR scan at the shop still works

    expect((await setAppJoin(cookie, true)).status).toBe(200);
    expect((await join(salonId, { ...customerDetails(), source: 'app' })).status).toBe(201);
  }, 60_000);

  it('the switch is owner-only, needs a session, and only takes a real boolean', async () => {
    const salonId = await makeSalon();
    expect((await request(app).patch('/api/barber/salon').send({ allowAppJoin: false })).status).toBe(401);
    const staff = await barberCookieFor(salonId, 'BARBER');
    expect((await setAppJoin(staff, false)).status).toBe(403);
    const owner = await barberCookieFor(salonId);
    for (const bad of ['false', 0, null]) expect((await setAppJoin(owner, bad)).status).toBe(400);

    const { data } = await supabase.from('salons').select('allow_app_join').eq('id', salonId).single();
    expect(data!.allow_app_join).toBe(true); // nothing changed
  }, 60_000);

  it('the same phone (remember token) joining again gets its own ticket back, not a second token', async () => {
    const salonId = await makeSalon();
    const first = await joinOk(salonId, { ...customerDetails(), source: 'app' });
    expect(first.rememberToken).toMatch(/^[a-f0-9]{64}$/);

    const again = await joinOk(salonId, { rememberToken: first.rememberToken, source: 'app' });
    expect(again.existing).toBe(true);
    expect(again.ticketId).toBe(first.ticketId);
    expect(again.tokenNumber).toBe(first.tokenNumber);
    expect(again.accessToken).toBe(first.accessToken);

    // Rescanning the wall QR on the same phone is the same rule.
    const scan = await joinOk(salonId, { rememberToken: first.rememberToken });
    expect(scan.ticketId).toBe(first.ticketId);

    expect(await ticketCount(salonId)).toBe(1);
  }, 60_000);

  it('two simultaneous joins from one phone make one ticket', async () => {
    const salonId = await makeSalon();
    const first = await joinOk(salonId, customerDetails());
    // Finish the first visit so the next two requests are both asking for a NEW ticket.
    await supabase.from('queue_entries').update({ status: 'COMPLETED', completed_at: new Date().toISOString() }).eq('id', first.ticketId);

    const [a, b] = await Promise.all([
      join(salonId, { rememberToken: first.rememberToken, source: 'app' }),
      join(salonId, { rememberToken: first.rememberToken, source: 'app' }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.ticket.ticketId).toBe(b.body.ticket.ticketId);
    expect(await ticketCount(salonId)).toBe(2); // the finished one + exactly one new one
  }, 60_000);

  it('someone who only knows the name and phone never gets the ticket handed to them', async () => {
    const salonId = await makeSalon();
    const details = customerDetails();
    const owner = await joinOk(salonId, details);

    const other = await join(salonId, { ...details, source: 'app' }); // another phone, same number typed in
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('ALREADY_IN_QUEUE');
    expect(JSON.stringify(other.body)).not.toContain(owner.accessToken);
    expect(JSON.stringify(other.body)).not.toContain(owner.ticketId);
    expect(await ticketCount(salonId)).toBe(1);

    // The refused attempt changed nothing: the real customer's remember token still works.
    const back = await joinOk(salonId, { rememberToken: owner.rememberToken });
    expect(back.ticketId).toBe(owner.ticketId);
  }, 60_000);

  it('a retried request with the same key still returns the same ticket (unchanged behaviour)', async () => {
    const salonId = await makeSalon();
    const d = customerDetails();
    const clientKey = 'k' + Math.random().toString(36).slice(2).padEnd(20, 'x');
    const first = await joinOk(salonId, { ...d, clientKey, source: 'app' });
    const retry = await joinOk(salonId, { ...d, clientKey, source: 'app' });
    expect(retry.ticketId).toBe(first.ticketId);
    expect(retry.existing).toBe(false);
    expect(await ticketCount(salonId)).toBe(1);
  }, 60_000);

  it('after the ticket is finished, the customer can take a new one', async () => {
    const salonId = await makeSalon();
    const t = await joinOk(salonId, { ...customerDetails(), source: 'app' });
    await supabase.from('queue_entries').update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() }).eq('id', t.ticketId);

    const fresh = await joinOk(salonId, { rememberToken: t.rememberToken, source: 'app' });
    expect(fresh.existing).toBe(false);
    expect(fresh.ticketId).not.toBe(t.ticketId);
    expect(fresh.tokenNumber).toBe(t.tokenNumber + 1);
  }, 60_000);

  it('one active ticket per salon, not per person: the same phone can wait at two salons', async () => {
    const a = await makeSalon();
    const b = await makeSalon();
    const d = customerDetails();
    expect((await join(a, { ...d, source: 'app' })).status).toBe(201);
    expect((await join(b, { ...d, source: 'app' })).status).toBe(201);
  }, 60_000);

  it('app joins never win a prize and do not use up the QR customers\' chances', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    // Expect 2 QR customers, 5 prizes: each of the first 2 QR scans is certain to win.
    await request(app).patch('/api/barber/offers/expected').set('Cookie', cookie).send({ expectedCustomers: 2 });
    await request(app).post('/api/barber/offers').set('Cookie', cookie).send({ name: 'Head massage', dailyCount: 5 });

    const appTickets: Ticket[] = [];
    for (let i = 0; i < 3; i++) appTickets.push(await joinOk(salonId, { ...customerDetails(), source: 'app' }));
    const qr1 = await joinOk(salonId, customerDetails());
    const qr2 = await joinOk(salonId, customerDetails());

    const prizeOf = async (id: string) =>
      (await supabase.from('queue_entries').select('offer_id, prize_code').eq('id', id).single()).data!;
    for (const t of appTickets) expect(await prizeOf(t.ticketId)).toEqual({ offer_id: null, prize_code: null });
    expect((await prizeOf(qr1.ticketId)).offer_id).not.toBeNull(); // the 3 app joins did not eat the pacing
    expect((await prizeOf(qr2.ticketId)).offer_id).not.toBeNull();

    const ticketView = await request(app).get(`/api/queue-tickets/${appTickets[0].ticketId}`).set('X-Ticket-Token', appTickets[0].accessToken);
    expect(ticketView.body.ticket.prize).toBeNull();
  }, 90_000);

  it('validates source', () => {
    expect(joinQueueBodySchema.safeParse({ source: 'app' }).success).toBe(true);
    expect(joinQueueBodySchema.safeParse({ source: 'qr' }).success).toBe(true);
    expect(joinQueueBodySchema.safeParse({ source: 'web' }).success).toBe(false);
    expect(joinQueueBodySchema.safeParse({ source: 1 }).success).toBe(false);
    expect(updateSalonProfileBodySchema.safeParse({ allowAppJoin: false }).success).toBe(true);
    expect(updateSalonProfileBodySchema.safeParse({ allowAppJoin: 'false' }).success).toBe(false);
  });

  it('a bad source over HTTP is a 400 and creates nothing', async () => {
    const salonId = await makeSalon();
    expect((await join(salonId, { ...customerDetails(), source: 'web' })).status).toBe(400);
    expect(await ticketCount(salonId)).toBe(0);
  }, 60_000);
});
