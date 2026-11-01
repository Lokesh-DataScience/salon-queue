import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { joinQueue } from '../src/services/queue.service';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const key = () => 'k' + Math.random().toString(36).slice(2).padEnd(20, 'x');

async function entriesOf(queueId: string) {
  const { data } = await supabase.from('queue_entries').select('token_number, offer_id, access_token').eq('queue_id', queueId);
  return data!;
}

describe('A scan never creates two tickets', () => {
  it('the same key used twice at once gives ONE ticket with the same token', async () => {
    const salonId = await makeSalon();
    const k = key();
    const [a, b] = await Promise.all([joinQueue(salonId, k), joinQueue(salonId, k)]);
    expect(b.ticketId).toBe(a.ticketId);
    expect(b.tokenNumber).toBe(a.tokenNumber);
    expect(b.accessToken).toBe(a.accessToken);
    expect(await entriesOf(a.queueId)).toHaveLength(1);
  }, 60_000);

  it('a retry of the same key after the first call finished returns the same ticket', async () => {
    const salonId = await makeSalon();
    const k = key();
    const a = await joinQueue(salonId, k);
    const again = await joinQueue(salonId, k);
    expect(again.ticketId).toBe(a.ticketId);
    expect(await entriesOf(a.queueId)).toHaveLength(1);
  }, 60_000);

  it('different keys are different customers; no key behaves as before', async () => {
    const salonId = await makeSalon();
    const a = await joinQueue(salonId, key());
    const b = await joinQueue(salonId, key());
    const c = await joinQueue(salonId);
    const d = await joinQueue(salonId);
    expect([a, b, c, d].map((t) => t.tokenNumber)).toEqual([1, 2, 3, 4]);
  }, 60_000);

  it('a repeated key never takes a second prize', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    await request(app).patch('/api/barber/offers/expected').set('Cookie', cookie).send({ expectedCustomers: 5 });
    await request(app).post('/api/barber/offers').set('Cookie', cookie).send({ name: 'Head massage', dailyCount: 5 });

    const k = key();
    await Promise.all([joinQueue(salonId, k), joinQueue(salonId, k)]);
    const second = await joinQueue(salonId, key());

    const rows = await entriesOf(second.queueId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((e) => e.offer_id)).toHaveLength(2); // exactly one prize per real customer
  }, 60_000);

  it('the API accepts a key, ignores other fields, and refuses a malformed key', async () => {
    const salonId = await makeSalon();
    const k = key();
    const first = await request(app).post(`/api/queues/${salonId}/join`).send({ clientKey: k, tokenNumber: 99 });
    const second = await request(app).post(`/api/queues/${salonId}/join`).send({ clientKey: k });
    expect(first.status).toBe(201);
    expect(first.body.ticket.tokenNumber).toBe(1);
    expect(second.body.ticket.ticketId).toBe(first.body.ticket.ticketId);

    const bad = await request(app).post(`/api/queues/${salonId}/join`).send({ clientKey: 'short' });
    expect(bad.status).toBe(400);
  }, 60_000);
});