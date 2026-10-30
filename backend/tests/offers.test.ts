// backend/tests/offers.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, joinViaApi, barberCookieFor } from './helpers';
import { joinQueue } from '../src/services/queue.service';
import { callNext, startEntry } from '../src/services/barber.service';
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
    expect((await request(app).post('/api/barber/offers/redeem').send({ code: 'ABC234' })).status).toBe(401);
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
  it('winner sees the prize on their own ticket; barber redeems once, only after service, only for their salon', async () => {
    const salonId = await makeSalon();
    const other = await makeSalon();
    const { cookie } = await addOffer(salonId, 'Head massage', 50);
    const t = (await joinViaApi(salonId)).body.ticket;

    const mine = await ticket(t.ticketId, t.accessToken);
    expect(mine.prize).toMatchObject({ name: 'Head massage', redeemed: false });
    expect(mine.prize.code).toMatch(/^[A-Z0-9]{6}$/);
    const code = mine.prize.code;

    const redeem = (c: string, ck = cookie) =>
      request(app).post('/api/barber/offers/redeem').set('Cookie', ck).send({ code: c });

    expect((await redeem(code)).status).toBe(409); // still WAITING
    await callNext(salonId);
    await startEntry(salonId, t.ticketId);

    expect((await redeem(code, await barberCookieFor(other))).status).toBe(404); // someone else's salon
    const ok = await redeem(code.toLowerCase()); // case-insensitive
    expect(ok.status).toBe(200);
    expect(ok.body.prizeName).toBe('Head massage');
    expect((await redeem(code)).status).toBe(409); // single use
    expect((await redeem('ZZZZZZ')).status).toBe(404);

    const list = await request(app).get('/api/barber/offers').set('Cookie', cookie);
    expect(list.body.totalRedeemedToday).toBe(1);
  });

  it('the barber snapshot and the live broadcast never reveal who won', async () => {
    const salonId = await makeSalon();
    const { cookie } = await addOffer(salonId, 'Scrub', 50);
    const t = (await joinViaApi(salonId)).body.ticket;
    const code = (await ticket(t.ticketId, t.accessToken)).prize.code;

    const snap = await request(app).get('/api/barber/queue').set('Cookie', cookie);
    const text = JSON.stringify(snap.body);
    expect(text).not.toContain(code);
    expect(text).not.toMatch(/offer_id|prize/);

    const status = await request(app).get(`/api/salons/${salonId}/queue`);
    expect(JSON.stringify(status.body)).not.toContain(code);
  });

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
describe('Editing the daily count applies immediately', () => {
  it("resets today's remaining prizes to the new number minus what was already won", async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    // expecting 1 customer with 3 prizes: the first scan wins for certain
    await request(app).patch('/api/barber/offers/expected').set('Cookie', cookie).send({ expectedCustomers: 1 });
    const { offer } = await addOffer(salonId, 'Head massage', 3);

    const t = await joinQueue(salonId); // wins 1, leaving 2
    const remaining = async () => {
      const { data } = await supabase
        .from('offer_daily_stock').select('remaining').eq('queue_id', t.queueId).eq('offer_id', offer.id).single();
      return data!.remaining;
    };
    expect(await remaining()).toBe(2);

    const edit = (n: number) =>
      request(app).patch(`/api/barber/offers/${offer.id}`).set('Cookie', cookie).send({ dailyCount: n });

    expect((await edit(10)).status).toBe(200);
    expect(await remaining()).toBe(9);   // 10 total, 1 already won

    expect((await edit(1)).status).toBe(200);
    expect(await remaining()).toBe(0);   // never negative, and the prize already won is not taken back

    const { data: won } = await supabase.from('queue_entries').select('offer_id').eq('id', t.ticketId).single();
    expect(won!.offer_id).toBe(offer.id);
  });

  it("another salon's barber cannot change the count", async () => {
    const salonA = await makeSalon();
    const salonB = await makeSalon();
    const { offer } = await addOffer(salonA, 'Scrub', 2);
    const cookieB = await barberCookieFor(salonB);
    const res = await request(app)
      .patch(`/api/barber/offers/${offer.id}`).set('Cookie', cookieB).send({ dailyCount: 50 });
    expect(res.status).toBe(404);
  });
});