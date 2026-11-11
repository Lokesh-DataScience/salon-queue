// backend/tests/offers.test.ts
import { randomUUID } from 'crypto';
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, joinViaApi, barberCookieFor } from './helpers';
import { joinQueue } from '../src/services/queue.service';
import { callNext, startEntry, addWalkIn } from '../src/services/barber.service';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

async function addOffer(salonId: string, name: string, dailyCount: number) {
  const cookie = await barberCookieFor(salonId);
  const res = await request(app).post('/api/barber/offers').set('Cookie', cookie).send({ name, dailyCount });
  expect(res.status).toBe(201);
  return { cookie, offer: res.body.offer };
}

async function ticket(id: string, token: string) {
  const res = await request(app).get(`/api/queue-tickets/${id}`).set('X-Ticket-Token', token);
  expect(res.status).toBe(200);
  return res.body.ticket;
}

async function entriesOf(queueId: string) {
  const { data } = await supabase
    .from('queue_entries')
    .select('token_number, is_walk_in, offer_id, prize_code')
    .eq('queue_id', queueId)
    .order('token_number');
  return data!;
}

async function setup(expected: number, prizes: number) {
  const salonId = await makeSalon();
  const cookie = await barberCookieFor(salonId);
  await request(app).patch('/api/barber/offers/expected').set('Cookie', cookie).send({ expectedCustomers: expected });
  await addOffer(salonId, 'Head massage', prizes);
  return salonId;
}

describe('Offers CRUD and ownership', () => {
  it('creates, lists, edits and soft-deletes only the barber\'s own offers', async () => {
    const salonA = await makeSalon();
    const salonB = await makeSalon();
    const a = await addOffer(salonA, 'Head massage', 5);
    const cookieB = await barberCookieFor(salonB);

    const listB = await request(app).get('/api/barber/offers').set('Cookie', cookieB);
    expect(listB.body.offers).toHaveLength(0);

    for (const call of [
      request(app).patch(`/api/barber/offers/${a.offer.id}`).set('Cookie', cookieB).send({ active: false }),
      request(app).delete(`/api/barber/offers/${a.offer.id}`).set('Cookie', cookieB),
    ]) expect((await call).status).toBe(404);

    const edit = await request(app)
      .patch(`/api/barber/offers/${a.offer.id}`).set('Cookie', a.cookie).send({ dailyCount: 3 });
    expect(edit.body.offer.dailyCount).toBe(3);

    expect((await request(app).delete(`/api/barber/offers/${a.offer.id}`).set('Cookie', a.cookie)).status).toBe(200);
    const listA = await request(app).get('/api/barber/offers').set('Cookie', a.cookie);
    expect(listA.body.offers).toHaveLength(0);
  });

  it('validates input and refuses unauthenticated callers', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    for (const body of [{ name: 'x', dailyCount: 5 }, { name: 'Scrub', dailyCount: 0 }, { name: 'Scrub', dailyCount: 51 }]) {
      expect((await request(app).post('/api/barber/offers').set('Cookie', cookie).send(body)).status).toBe(400);
    }
    expect((await request(app).get('/api/barber/offers')).status).toBe(401);
    expect((await request(app).post(`/api/barber/queue/${randomUUID()}/redeem-prize`)).status).toBe(401);
  });
});

describe('Prize draw', () => {
  it('never awards more than the daily count, even with simultaneous joins', async () => {
    const salonId = await makeSalon();
    await addOffer(salonId, 'Scrub', 2);
    const results = await Promise.all(Array.from({ length: 20 }, () => joinQueue(salonId)));

    const { data } = await supabase
      .from('queue_entries').select('offer_id, prize_code').eq('queue_id', results[0].queueId);
    const winners = (data ?? []).filter((e) => e.offer_id);
    expect(winners.length).toBeLessThanOrEqual(2);
    expect(new Set(winners.map((w) => w.prize_code)).size).toBe(winners.length);
    expect(new Set(results.map((r) => r.tokenNumber)).size).toBe(20); // tokens still unique
  });

  it('a salon with no offers never draws', async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    const { data } = await supabase.from('queue_entries').select('offer_id, prize_code').eq('id', t.ticketId).single();
    expect(data!.offer_id).toBeNull();
    expect(data!.prize_code).toBeNull();
  });

  it('a switched-off offer is never awarded', async () => {
    const salonId = await makeSalon();
    const { cookie, offer } = await addOffer(salonId, 'Scrub', 50);
    await request(app).patch(`/api/barber/offers/${offer.id}`).set('Cookie', cookie).send({ active: false });
    const t = await joinQueue(salonId);
    const { data } = await supabase.from('queue_entries').select('offer_id').eq('id', t.ticketId).single();
    expect(data!.offer_id).toBeNull();
  });
});

describe('Reveal, redeem and secrecy', () => {
  // dailyCount 50 makes the chance 1.0 for the first customers, so the winner is certain.
  it('winner sees the prize (no code) on their ticket; barber redeems with one tap, once, only when served, only for their own salon', async () => {
    const salonId = await makeSalon();
    const other = await makeSalon();
    const { cookie } = await addOffer(salonId, 'Head massage', 50);
    const t = await joinQueue(salonId);

    const mine = await ticket(t.ticketId, t.accessToken);
    expect(mine.prize).toEqual({ name: 'Head massage', redeemed: false }); // no code is exposed

    const redeem = (id: string, ck = cookie) =>
      request(app).post(`/api/barber/queue/${id}/redeem-prize`).set('Cookie', ck);

    expect((await redeem(t.ticketId)).status).toBe(409); // still WAITING
    await callNext(salonId);
    expect((await redeem(t.ticketId)).status).toBe(409); // CALLED, not served yet
    await startEntry(salonId, t.ticketId);

    expect((await redeem(t.ticketId, await barberCookieFor(other))).status).toBe(404); // someone else's salon
    const ok = await redeem(t.ticketId);
    expect(ok.status).toBe(200);
    expect(ok.body.prizeName).toBe('Head massage');
    expect((await redeem(t.ticketId)).status).toBe(409); // single use
    expect((await redeem(randomUUID())).status).toBe(404);

    const list = await request(app).get('/api/barber/offers').set('Cookie', cookie);
    expect(list.body.totalRedeemedToday).toBe(1);
  }, 60_000);

  it('the barber snapshot never shows a prize on a waiting row, and no prize code anywhere', async () => {
    const salonId = await makeSalon();
    const { cookie } = await addOffer(salonId, 'Scrub', 50);
    const a = await joinQueue(salonId);
    await joinQueue(salonId);

    const snap = await request(app).get('/api/barber/queue').set('Cookie', cookie);
    expect(snap.status).toBe(200);
    expect(snap.body.waiting.every((e: { prize: unknown }) => e.prize === null)).toBe(true);

    const text = JSON.stringify(snap.body);
    expect(text).not.toMatch(/offer_id|prize_code|prize_redeemed_at/);
    const { data } = await supabase.from('queue_entries').select('prize_code').eq('queue_id', a.queueId);
    const codes = (data ?? []).map((r) => r.prize_code).filter(Boolean) as string[];
    for (const code of codes) expect(text).not.toContain(code);

    const status = await request(app).get(`/api/salons/${salonId}/queue`);
    for (const code of codes) expect(JSON.stringify(status.body)).not.toContain(code);
  }, 60_000);

  it('the customer at the chair shows their prize to the barber, and it flips to redeemed after the tap', async () => {
    const salonId = await makeSalon();
    const { cookie } = await addOffer(salonId, 'Scrub', 50);
    const t = await joinQueue(salonId);
    await callNext(salonId);
    await startEntry(salonId, t.ticketId);

    const before = await request(app).get('/api/barber/queue').set('Cookie', cookie);
    expect(before.body.serving.prize).toEqual({ name: 'Scrub', redeemed: false });

    const tap = await request(app).post(`/api/barber/queue/${t.ticketId}/redeem-prize`).set('Cookie', cookie);
    expect(tap.status).toBe(200);

    const after = await request(app).get('/api/barber/queue').set('Cookie', cookie);
    expect(after.body.serving.prize).toEqual({ name: 'Scrub', redeemed: true });
  }, 60_000);

  it("another customer's token cannot read the prize", async () => {
    const salonId = await makeSalon();
    await addOffer(salonId, 'Scrub', 50);
    const a = (await joinViaApi(salonId)).body.ticket;
    const b = (await joinViaApi(salonId)).body.ticket;
    const cross = await request(app).get(`/api/queue-tickets/${a.ticketId}`).set('X-Ticket-Token', b.accessToken);
    expect(cross.status).toBe(404);
  });
  it('a quiet salon is still paced over at least 15 customers, so prizes are not handed to the first scans', async () => {
    const salonId = await makeSalon();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { data: past } = await supabase
      .from('queues')
      .insert({ salon_id: salonId, date: yesterday, current_token: 0, next_token: 3, status: 'ACTIVE' })
      .select('id')
      .single();
    await supabase.from('queue_entries').insert(
      [1, 2].map((n) => ({
        queue_id: past!.id,
        token_number: n,
        status: 'COMPLETED',
        access_token: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      })),
    );

    await addOffer(salonId, 'Head massage', 5);
    const t = await joinQueue(salonId);

    const { data: q } = await supabase.from('queues').select('prize_expected').eq('id', t.queueId).single();
    expect(q!.prize_expected).toBeGreaterThanOrEqual(15);
  });
});
describe('Expected customers setting', () => {
  it('is saved per salon, validated, and can be cleared', async () => {
    const salonA = await makeSalon();
    const salonB = await makeSalon();
    const cookieA = await barberCookieFor(salonA);
    const cookieB = await barberCookieFor(salonB);
    const set = (ck: string, v: unknown) =>
      request(app).patch('/api/barber/offers/expected').set('Cookie', ck).send({ expectedCustomers: v });

    expect((await set(cookieA, 25)).body.expectedCustomers).toBe(25);
    for (const bad of [0, 501, 2.5, 'ten']) expect((await set(cookieA, bad)).status).toBe(400);

    const a = await request(app).get('/api/barber/offers').set('Cookie', cookieA);
    const b = await request(app).get('/api/barber/offers').set('Cookie', cookieB);
    expect(a.body.expectedCustomers).toBe(25);
    expect(b.body.expectedCustomers).toBeNull(); // another salon is untouched

    expect((await set(cookieA, null)).body.expectedCustomers).toBeNull();
    expect((await request(app).patch('/api/barber/offers/expected').send({ expectedCustomers: 5 })).status).toBe(401);
  });

  it("drives the pacing: expecting 1 customer with 3 prizes makes the first scan win", async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    await request(app).patch('/api/barber/offers/expected').set('Cookie', cookie).send({ expectedCustomers: 1 });
    await addOffer(salonId, 'Head massage', 3);

    const t = await joinQueue(salonId);
    const { data } = await supabase.from('queue_entries').select('offer_id').eq('id', t.ticketId).single();
    expect(data!.offer_id).not.toBeNull(); // with the default 15 this would be only a 1-in-5 chance
  });
});

describe('Reward campaign spec: QR customers only', () => {
  it('Test A: 5 prizes, 5 expected QR customers, scanned simultaneously: all 5 win once, with distinct codes', async () => {
    const salonId = await setup(5, 5);
    const r = await Promise.all(Array.from({ length: 5 }, () => joinQueue(salonId)));
    const rows = await entriesOf(r[0].queueId);
    expect(rows.map((e) => e.token_number)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((e) => e.offer_id)).toBe(true);
    expect(new Set(rows.map((e) => e.prize_code)).size).toBe(5);
  }, 120_000);

  it('Test B: walk-ins between QR scans never win and never use up the odds; scanner #8 gets the 5th prize', async () => {
    const salonId = await setup(5, 5);
    const first = await joinQueue(salonId);   // #1 QR
    await joinQueue(salonId);                 // #2 QR
    await addWalkIn(salonId);                 // #3 walk-in
    await joinQueue(salonId);                 // #4 QR
    await addWalkIn(salonId);                 // #5 walk-in
    await joinQueue(salonId);                 // #6 QR
    await addWalkIn(salonId);                 // #7 walk-in
    await joinQueue(salonId);                 // #8 QR

    const rows = await entriesOf(first.queueId);
    expect(rows.map((e) => e.token_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // queue numbering unchanged
    expect(rows.filter((e) => !e.is_walk_in).map((e) => e.token_number)).toEqual([1, 2, 4, 6, 8]);
    expect(rows.filter((e) => !e.is_walk_in).every((e) => e.offer_id)).toBe(true);
    expect(rows.filter((e) => e.is_walk_in).every((e) => !e.offer_id)).toBe(true);
  }, 120_000);

  it('Test C: 5 prizes, 20 expected QR customers: exactly 5 win, each at most once', async () => {
    const salonId = await setup(20, 5);
    const r = await Promise.all(Array.from({ length: 20 }, () => joinQueue(salonId)));
    const rows = await entriesOf(r[0].queueId);
    const winners = rows.filter((e) => e.offer_id);
    expect(winners).toHaveLength(5);
    expect(new Set(winners.map((e) => e.prize_code)).size).toBe(5);
  }, 120_000);

  it('after the expected QR count is reached, later scanners are not eligible', async () => {
    const salonId = await setup(2, 5);
    const r = await Promise.all(Array.from({ length: 4 }, () => joinQueue(salonId)));
    const rows = await entriesOf(r[0].queueId);
    expect(rows.filter((e) => e.offer_id)).toHaveLength(2); // only the first 2 scanners
    expect(rows[2].offer_id).toBeNull();
    expect(rows[3].offer_id).toBeNull();
  }, 120_000);
}); 