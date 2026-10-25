// backend/tests/queue.test.ts  (spec §51 tests 1–4, plus pause, last-customer, leave)
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, joinViaApi } from './helpers';
import { joinQueue } from '../src/services/queue.service';
import { callNext, startEntry, pauseQueue, resumeQueue } from '../src/services/barber.service';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

async function statusOf(entryId: string) {
  const { data } = await supabase.from('queue_entries').select('status, cancelled_at').eq('id', entryId).single();
  return data!;
}

describe('Test 1: concurrent joins', () => {
  it('never hands out duplicate tokens', async () => {
    const salonId = await makeSalon(); // no queue exists yet: worst case
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => joinQueue(salonId)),
    );
    const tokens = results.map((r) => r.tokenNumber).sort((a, b) => a - b);
    expect(tokens).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('Test 2: NEXT pressed twice at once', () => {
  it('performs exactly one transition', async () => {
    const salonId = await makeSalon();
    for (let i = 0; i < 3; i++) await joinQueue(salonId);

    const outcomes = await Promise.allSettled([callNext(salonId), callNext(salonId)]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason.message)).toMatch(/already being called/i);

    const { data: queue } = await supabase.from('queues').select('id, current_token').eq('salon_id', salonId).single();
    const { data: called } = await supabase.from('queue_entries').select('token_number').eq('queue_id', queue!.id).eq('status', 'CALLED');
    expect(called).toHaveLength(1);
    expect(queue!.current_token).toBe(1);
  });
});

describe("Test 3: another ticket's secret token", () => {
  it('is denied', async () => {
    const salonId = await makeSalon();
    const a = (await joinViaApi(salonId)).body.ticket;
    const b = (await joinViaApi(salonId)).body.ticket;

    const own = await request(app).get(`/api/queue-tickets/${a.ticketId}`).query({ accessToken: a.accessToken });
    expect(own.status).toBe(200);

    const cross = await request(app).get(`/api/queue-tickets/${a.ticketId}`).query({ accessToken: b.accessToken });
    expect(cross.status).toBe(404);

    const crossLeave = await request(app).post(`/api/queue-tickets/${a.ticketId}/leave`).send({ accessToken: b.accessToken });
    expect(crossLeave.status).toBe(404);
    expect((await statusOf(a.ticketId)).status).toBe('WAITING');
  });
});

describe('Test 4: customer tries to change their queue position', () => {
  it('is rejected or ignored', async () => {
    const salonId = await makeSalon();
    await joinViaApi(salonId);
    const sneaky = await request(app)
      .post(`/api/queues/${salonId}/join`)
      .send({ tokenNumber: 1, status: 'CALLED', position: 0 });

    expect([201, 400]).toContain(sneaky.status); // strict schema rejects, loose schema ignores
    if (sneaky.status === 201) {
      expect(sneaky.body.ticket.tokenNumber).toBe(2);
      expect(sneaky.body.ticket.status).toBe('WAITING');
    }

    const id = sneaky.body.ticket?.ticketId ?? '00000000-0000-0000-0000-000000000000';
    expect((await request(app).patch(`/api/queue-tickets/${id}`).send({ tokenNumber: 1 })).status).toBe(404);
    expect((await request(app).put(`/api/queue-tickets/${id}`).send({ status: 'SERVING' })).status).toBe(404);
  });
});

describe('Pause blocks joining (Bug 1)', () => {
  it('refuses joins while paused, accepts them after resume', async () => {
    const salonId = await makeSalon();
    await joinViaApi(salonId);
    await pauseQueue(salonId);

    const blocked = await joinViaApi(salonId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('Queue is paused.');

    await resumeQueue(salonId);
    expect((await joinViaApi(salonId)).status).toBe(201);
  });
});

describe('NEXT on the last customer (Bug 2)', () => {
  it('completes them and succeeds instead of erroring', async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    await callNext(salonId);
    await startEntry(salonId, t.ticketId);

    await expect(callNext(salonId)).resolves.toBeTruthy();
    expect((await statusOf(t.ticketId)).status).toBe('COMPLETED');
  });
});

describe('Customer leave', () => {
  it('cancels a waiting ticket once, and refuses after being called', async () => {
    const salonId = await makeSalon();
    const a = (await joinViaApi(salonId)).body.ticket;

    const first = await request(app).post(`/api/queue-tickets/${a.ticketId}/leave`).send({ accessToken: a.accessToken });
    expect(first.status).toBe(200);
    const row = await statusOf(a.ticketId);
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelled_at).not.toBeNull();

    const again = await request(app).post(`/api/queue-tickets/${a.ticketId}/leave`).send({ accessToken: a.accessToken });
    expect(again.status).toBe(409);

    const b = (await joinViaApi(salonId)).body.ticket;
    await callNext(salonId);
    const late = await request(app).post(`/api/queue-tickets/${b.ticketId}/leave`).send({ accessToken: b.accessToken });
    expect(late.status).toBe(409);
  });
});