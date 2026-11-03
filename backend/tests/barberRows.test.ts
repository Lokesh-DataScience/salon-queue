// backend/tests/barberRows.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { callNext, startEntry, completeEntry, addWalkIn } from '../src/services/barber.service';

afterAll(cleanupSalons);

// dailyCount 50 makes the first customers' chance 1.0, so the winner is certain.
async function setup(prizes = 50) {
  const salonId = await makeSalon();
  const cookie = await barberCookieFor(salonId);
  let offerId: string | null = null;
  if (prizes > 0) {
    const res = await request(app)
      .post('/api/barber/offers').set('Cookie', cookie).send({ name: 'Head massage', dailyCount: prizes });
    expect(res.status).toBe(201);
    offerId = res.body.offer.id as string;
  }
  // The two default services come from the trigger on new salons.
  const services = (await request(app).get(`/api/queues/${salonId}/services`)).body.services as {
    id: string;
    name: string;
  }[];
  return { salonId, cookie, offerId, services };
}

async function joinWith(salonId: string, serviceIds: string[]) {
  const res = await request(app).post(`/api/queues/${salonId}/join`).send({ serviceIds });
  expect(res.status).toBe(201);
  return res.body.ticket as { ticketId: string; accessToken: string; tokenNumber: number };
}

async function codeOf(t: { ticketId: string; accessToken: string }) {
  const res = await request(app).get(`/api/queue-tickets/${t.ticketId}`).set('X-Ticket-Token', t.accessToken);
  expect(res.status).toBe(200);
  return res.body.ticket.prize.code as string;
}

const snapshot = (cookie: string) => request(app).get('/api/barber/queue').set('Cookie', cookie);
const claim = (cookie: string, entryId: string) =>
  request(app).post(`/api/barber/queue/${entryId}/claim`).set('Cookie', cookie);

describe('Barber snapshot rows (step 9)', () => {
  it('a waiting row shows the chosen services and carries no prize data at all', async () => {
    const { salonId, cookie, services } = await setup();
    const t = await joinWith(salonId, services.map((s) => s.id));
    const code = await codeOf(t); // the customer did win, so the barber still must not see it

    const snap = await snapshot(cookie);
    const row = snap.body.waiting[0];
    expect(row.services).toEqual(['beard trimming', 'hair cutting']);
    expect(Object.keys(row)).not.toContain('prize');
    expect(JSON.stringify(snap.body)).not.toContain(code);
  });

  it('a customer who chose nothing and a walk-in both show an empty services list', async () => {
    const { salonId, cookie } = await setup(0);
    await joinWith(salonId, []);
    await addWalkIn(salonId);

    const snap = await snapshot(cookie);
    expect(snap.body.waiting.map((w: { services: string[] }) => w.services)).toEqual([[], []]);
  });

  it('once called, the entry carries its services and its prize with the code', async () => {
    const { salonId, cookie, services } = await setup();
    const t = await joinWith(salonId, services.map((s) => s.id));
    const code = await codeOf(t);
    await callNext(salonId);

    const snap = await snapshot(cookie);
    expect(snap.body.waiting).toHaveLength(0);
    expect(snap.body.called.services).toEqual(['beard trimming', 'hair cutting']);
    expect(snap.body.called.prize).toEqual({ name: 'Head massage', code, redeemed: false });

    await startEntry(salonId, t.ticketId);
    const serving = await snapshot(cookie);
    expect(serving.body.serving.prize).toEqual({ name: 'Head massage', code, redeemed: false });
  });

  it('a called customer who won nothing has prize null', async () => {
    const { salonId, cookie } = await setup(0);
    await joinWith(salonId, []);
    await callNext(salonId);

    const snap = await snapshot(cookie);
    expect(snap.body.called.prize).toBeNull();
  });

  it('a winner still shows the offer name after the barber removed that offer', async () => {
    const { salonId, cookie, offerId } = await setup();
    await joinWith(salonId, []);
    await callNext(salonId);
    expect((await request(app).delete(`/api/barber/offers/${offerId}`).set('Cookie', cookie)).status).toBe(200);

    const snap = await snapshot(cookie);
    expect(snap.body.called.prize.name).toBe('Head massage');
  });

  it('services and prizes of another salon never appear', async () => {
    const a = await setup();
    const b = await setup();
    const t = await joinWith(a.salonId, a.services.map((s) => s.id));
    const code = await codeOf(t);
    await callNext(a.salonId);

    const other = await snapshot(b.cookie);
    expect(other.body.called).toBeNull();
    expect(other.body.waiting).toHaveLength(0);
    expect(JSON.stringify(other.body)).not.toContain(code);
  });
});

describe('Claim an offer by entry (step 9)', () => {
  it('needs a session', async () => {
    const res = await request(app).post('/api/barber/queue/00000000-0000-4000-8000-000000000000/claim');
    expect(res.status).toBe(401);
  });

  it('claims once for a called customer, then refuses a second claim', async () => {
    const { salonId, cookie } = await setup();
    const t = await joinWith(salonId, []);
    await callNext(salonId);

    const first = await claim(cookie, t.ticketId);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ prizeName: 'Head massage' });

    const second = await claim(cookie, t.ticketId);
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already claimed/i);

    const snap = await snapshot(cookie);
    expect(snap.body.called.prize.redeemed).toBe(true);
  });

  it('claims for a serving customer, and the Offers count goes up', async () => {
    const { salonId, cookie } = await setup();
    const t = await joinWith(salonId, []);
    await callNext(salonId);
    await startEntry(salonId, t.ticketId);

    expect((await claim(cookie, t.ticketId)).status).toBe(200);

    const offers = await request(app).get('/api/barber/offers').set('Cookie', cookie);
    expect(offers.body.totalRedeemedToday).toBe(1);
  });

  it('two simultaneous claims: exactly one wins', async () => {
    const { salonId, cookie } = await setup();
    const t = await joinWith(salonId, []);
    await callNext(salonId);

    const results = await Promise.all([claim(cookie, t.ticketId), claim(cookie, t.ticketId)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('refuses a customer who is still waiting', async () => {
    const { salonId, cookie } = await setup();
    const t = await joinWith(salonId, []);
    const res = await claim(cookie, t.ticketId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/being served/i);
  });

  it('refuses a customer who has no offer', async () => {
    const { salonId, cookie } = await setup(0);
    const t = await joinWith(salonId, []);
    await callNext(salonId);
    const res = await claim(cookie, t.ticketId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/no offer/i);
  });

  it('refuses once the customer has been completed', async () => {
    const { salonId, cookie } = await setup();
    const t = await joinWith(salonId, []);
    await callNext(salonId);
    await startEntry(salonId, t.ticketId);
    await completeEntry(salonId, t.ticketId);

    expect((await claim(cookie, t.ticketId)).status).toBe(409);
  });

  it("another salon's barber cannot claim, and gets the same answer as for a missing entry", async () => {
    const a = await setup();
    const t = await joinWith(a.salonId, []);
    await callNext(a.salonId);
    const otherCookie = await barberCookieFor(await makeSalon());

    expect((await claim(otherCookie, t.ticketId)).status).toBe(404);
    expect((await snapshot(a.cookie)).body.called.prize.redeemed).toBe(false); // untouched
  });

  it('rejects a malformed entry id', async () => {
    const { cookie } = await setup(0);
    expect((await claim(cookie, 'not-a-uuid')).status).toBe(400);
  });

  it('a claimed offer cannot be redeemed again by its code', async () => {
    const { salonId, cookie } = await setup();
    const t = await joinWith(salonId, []);
    const code = await codeOf(t);
    await callNext(salonId);
    expect((await claim(cookie, t.ticketId)).status).toBe(200);

    const again = await request(app).post('/api/barber/offers/redeem').set('Cookie', cookie).send({ code });
    expect(again.status).toBe(409);
  });

  it("the customer's own ticket shows the offer as redeemed after the claim", async () => {
    const { salonId, cookie } = await setup();
    const t = await joinWith(salonId, []);
    await callNext(salonId);
    await claim(cookie, t.ticketId);

    const res = await request(app).get(`/api/queue-tickets/${t.ticketId}`).set('X-Ticket-Token', t.accessToken);
    expect(res.body.ticket.prize.redeemed).toBe(true);
  });
});