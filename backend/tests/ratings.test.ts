// backend/tests/ratings.test.ts — customer app polish, slice 5: star ratings.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, joinViaApi, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

async function completedTicket(salonId: string, daysAgo = 0) {
  const t = (await joinViaApi(salonId)).body.ticket;
  await supabase
    .from('queue_entries')
    .update({ status: 'COMPLETED', completed_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString() })
    .eq('id', t.ticketId);
  return t as { ticketId: string; accessToken: string; tokenNumber: number };
}

const rate = (t: { ticketId: string; accessToken: string }, stars: unknown, token = t.accessToken) =>
  request(app).post(`/api/queue-tickets/${t.ticketId}/rating`).send({ accessToken: token, stars });
const mine = (t: { ticketId: string; accessToken: string }, token = t.accessToken) =>
  request(app).get(`/api/queue-tickets/${t.ticketId}/rating`).set('X-Ticket-Token', token);
const publicQueue = (salonId: string) => request(app).get(`/api/salons/${salonId}/queue-public`);

describe('rating a finished visit', () => {
  it('a completed visit can be rated, read back, and changed (still one rating)', async () => {
    const salonId = await makeSalon();
    const t = await completedTicket(salonId);

    expect((await mine(t)).body).toEqual({ stars: null, canRate: true });
    const res = await rate(t, 4);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stars: 4 });
    expect((await mine(t)).body).toEqual({ stars: 4, canRate: true });

    await rate(t, 2);
    const { data } = await supabase.from('ticket_ratings').select('stars, salon_id').eq('ticket_id', t.ticketId);
    expect(data).toEqual([{ stars: 2, salon_id: salonId }]);
  });

  it('cannot rate before the service is complete', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    const res = await rate(t, 5);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_COMPLETED');
    expect((await mine(t)).body).toEqual({ stars: null, canRate: false });
  });

  it('cannot rate a visit more than 7 days old', async () => {
    const salonId = await makeSalon();
    const t = await completedTicket(salonId, 8);
    const res = await rate(t, 5);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TOO_LATE');
  });

  it("refuses another ticket's token and a junk token, saving nothing", async () => {
    const salonId = await makeSalon();
    const a = await completedTicket(salonId);
    const b = await completedTicket(salonId);
    expect((await rate(a, 5, b.accessToken)).status).toBe(404);
    expect((await rate(a, 5, 'x'.repeat(40))).status).toBe(404);
    expect((await mine(a, 'x'.repeat(40))).status).toBe(404);
    const { data } = await supabase.from('ticket_ratings').select('stars').eq('ticket_id', a.ticketId);
    expect(data).toEqual([]);
  });

  it('accepts only whole stars from 1 to 5', async () => {
    const salonId = await makeSalon();
    const t = await completedTicket(salonId);
    for (const stars of [0, 6, 3.5, '5', null]) {
      expect((await rate(t, stars)).status, String(stars)).toBe(400);
    }
  });
});

describe('the salon rating customers see', () => {
  it('stays hidden until 5 ratings, then shows the average to one decimal', async () => {
    const salonId = await makeSalon();
    for (const stars of [5, 5, 4, 4]) await rate(await completedTicket(salonId), stars);
    expect((await publicQueue(salonId)).body.salon.rating).toBeNull();

    await rate(await completedTicket(salonId), 3);
    expect((await publicQueue(salonId)).body.salon.rating).toEqual({ average: 4.2, count: 5 });
  }, 120_000);

  it('carries only the average and count, nothing about who rated', async () => {
    const salonId = await makeSalon();
    for (let i = 0; i < 5; i++) await rate(await completedTicket(salonId), 5);
    const text = JSON.stringify((await publicQueue(salonId)).body.salon.rating);
    expect(text).toBe('{"average":5,"count":5}');
  }, 120_000);
});

describe('the owner view', () => {
  it('shows the owner their own ratings even below 5, with the breakdown', async () => {
    const salonId = await makeSalon();
    const other = await makeSalon();
    await rate(await completedTicket(salonId), 5);
    await rate(await completedTicket(salonId), 3);
    await rate(await completedTicket(other), 1); // another salon's rating never counts here

    const cookie = await barberCookieFor(salonId);
    const res = await request(app).get('/api/barber/rating').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      count: 2,
      average: 4,
      byStars: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 },
      minPublic: 5,
      publiclyVisible: false,
    });
  }, 120_000);

  it('needs a signed-in owner', async () => {
    expect((await request(app).get('/api/barber/rating')).status).toBe(401);
  });
});
