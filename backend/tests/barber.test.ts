// backend/tests/barber.test.ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, joinViaApi, barberCookieFor, plantLegacyPersonalData } from './helpers';
import { joinQueue, getSanitizedQueueState, leaveTicket } from '../src/services/queue.service';
import { callNext, startEntry, completeEntry, skipEntry } from '../src/services/barber.service';
import { supabase } from '../src/config/supabase';
import { setIO } from '../src/sockets/io';

afterAll(cleanupSalons);

async function row(id: string) {
  const { data } = await supabase
    .from('queue_entries')
    .select('status, started_at, completed_at, skipped_at, cancelled_at')
    .eq('id', id)
    .single();
  return data!;
}

const conflict = { statusCode: 409 };

describe('State machine', () => {
  it('walks WAITING → CALLED → SERVING → COMPLETED and stamps each step', async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    expect((await row(t.ticketId)).status).toBe('WAITING');

    await callNext(salonId);
    expect((await row(t.ticketId)).status).toBe('CALLED');

    await startEntry(salonId, t.ticketId);
    const serving = await row(t.ticketId);
    expect(serving.status).toBe('SERVING');
    expect(serving.started_at).not.toBeNull();

    await completeEntry(salonId, t.ticketId);
    const done = await row(t.ticketId);
    expect(done.status).toBe('COMPLETED');
    expect(done.completed_at).not.toBeNull();
  });

  it('rejects invalid transitions with 409', async () => {
    const salonId = await makeSalon();
    const a = await joinQueue(salonId);
    await joinQueue(salonId);

    await expect(completeEntry(salonId, a.ticketId)).rejects.toMatchObject(conflict); // WAITING
    await expect(startEntry(salonId, a.ticketId)).rejects.toMatchObject(conflict); // WAITING

    await callNext(salonId); // A is CALLED
    await expect(completeEntry(salonId, a.ticketId)).rejects.toMatchObject(conflict); // CALLED, not SERVING

    await startEntry(salonId, a.ticketId);
    await completeEntry(salonId, a.ticketId);
    // A is COMPLETED: terminal. Nothing may touch it again.
    await expect(completeEntry(salonId, a.ticketId)).rejects.toMatchObject(conflict);
    await expect(startEntry(salonId, a.ticketId)).rejects.toMatchObject(conflict);
    await expect(skipEntry(salonId, a.ticketId)).rejects.toMatchObject(conflict);
  });

  it('skips from WAITING, CALLED and SERVING, and skipping a called customer unblocks NEXT', async () => {
    const salonId = await makeSalon();
    const c1 = await joinQueue(salonId);
    const c2 = await joinQueue(salonId);
    const c3 = await joinQueue(salonId);

    await callNext(salonId); // C1 CALLED
    await skipEntry(salonId, c1.ticketId);
    expect((await row(c1.ticketId)).status).toBe('SKIPPED');

    await callNext(salonId); // would 409 "already being called" if C1 still blocked it
    await startEntry(salonId, c2.ticketId); // C2 SERVING
    await skipEntry(salonId, c2.ticketId);
    expect((await row(c2.ticketId)).status).toBe('SKIPPED');

    await skipEntry(salonId, c3.ticketId); // WAITING
    for (const id of [c1.ticketId, c2.ticketId, c3.ticketId]) {
      const r = await row(id);
      expect(r.status).toBe('SKIPPED');
      expect(r.skipped_at).not.toBeNull();
    }
    await expect(skipEntry(salonId, c3.ticketId)).rejects.toMatchObject(conflict); // already skipped
  });

  it('NEXT before anyone has joined is a clear 409, not a crash', async () => {
    const salonId = await makeSalon();
    await expect(callNext(salonId)).rejects.toMatchObject(conflict);
  });
});

describe('Races between actors', () => {
  it('barber completes while another action skips the same customer: exactly one wins', async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    await callNext(salonId);
    await startEntry(salonId, t.ticketId); // SERVING

    const outcomes = await Promise.allSettled([
      completeEntry(salonId, t.ticketId),
      skipEntry(salonId, t.ticketId),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);

    const final = await row(t.ticketId);
    const winner = outcomes[0].status === 'fulfilled' ? 'COMPLETED' : 'SKIPPED';
    expect(final.status).toBe(winner);
    // The loser must not have left its timestamp behind.
    if (winner === 'COMPLETED') expect(final.skipped_at).toBeNull();
    else expect(final.completed_at).toBeNull();
  });

  it('customer leaving while the barber calls NEXT never leaves a contradictory state', async () => {
    for (let i = 0; i < 3; i++) {
      const salonId = await makeSalon();
      const t = await joinQueue(salonId);

      const [leave] = await Promise.allSettled([
        leaveTicket(t.ticketId, t.accessToken),
        callNext(salonId),
      ]);

      const final = (await row(t.ticketId)).status;
      // If the customer was told "you left", the entry must really be CANCELLED, not overwritten to CALLED.
      if (leave.status === 'fulfilled') expect(final).toBe('CANCELLED');
      else expect(final).toBe('CALLED');
    }
  });
});

describe('Ownership: a barber can only touch their own salon', () => {
  it("salon B's barber cannot act on salon A's customers, and the entry is left untouched", async () => {
    const salonA = await makeSalon();
    const salonB = await makeSalon();
    const entryA = (await joinViaApi(salonA)).body.ticket;
    const cookieB = await barberCookieFor(salonB);

    for (const action of ['start', 'complete', 'skip']) {
      const res = await request(app)
        .post(`/api/barber/queue/${entryA.ticketId}/${action}`)
        .set('Cookie', cookieB);
      expect(res.status).toBe(404);
    }
    expect((await row(entryA.ticketId)).status).toBe('WAITING');
  });

  it("a barber's dashboard shows only their own salon's customers", async () => {
    const salonA = await makeSalon();
    const salonB = await makeSalon();
    await joinViaApi(salonA);
    await joinViaApi(salonB);
    const cookieA = await barberCookieFor(salonA);

    const snap = await request(app).get('/api/barber/queue').set('Cookie', cookieA);
    expect(snap.status).toBe(200);
    expect(snap.body.waiting).toHaveLength(1);
    const text = JSON.stringify(snap.body);
    expect(text).not.toContain('customer_name');
    expect(text).not.toContain('customer_phone');
  });

  it("pausing affects only the caller's own queue", async () => {
    const salonA = await makeSalon();
    const salonB = await makeSalon();
    await joinViaApi(salonA);
    await joinViaApi(salonB);
    const cookieB = await barberCookieFor(salonB);

    expect((await request(app).post('/api/barber/queue/pause').set('Cookie', cookieB)).status).toBe(200);
    const { data } = await supabase.from('queues').select('status').eq('salon_id', salonA).single();
    expect(data!.status).toBe('ACTIVE');
  });

  it('every barber route refuses an unauthenticated caller', async () => {
    const id = '00000000-0000-0000-0000-000000000000';
    const routes: [string, string][] = [
      ['get', '/api/barber/queue'],
      ['post', '/api/barber/queue/next'],
      ['post', '/api/barber/queue/pause'],
      ['post', '/api/barber/queue/resume'],
      ['post', `/api/barber/queue/${id}/start`],
      ['post', `/api/barber/queue/${id}/complete`],
      ['post', `/api/barber/queue/${id}/skip`],
    ];
    for (const [method, path] of routes) {
      const res = await (request(app) as any)[method](path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });
});

describe('Public surfaces never leak customer details', () => {
  const emitted: { room: string; event: string; payload: any }[] = [];

  beforeAll(() => {
    setIO({
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          emitted.push({ room, event, payload });
        },
      }),
    } as never);
  });
  afterAll(() => {
    setIO({ to: () => ({ emit: () => undefined }) } as never); // restore the no-op from setup.ts
  });

  it('the live broadcast carries only id, token and status', async () => {
    const salonId = await makeSalon();
    const j = await joinViaApi(salonId);
    const NAME = 'Zephyr Quillfeather';
    const PHONE = '9123450099';
    await plantLegacyPersonalData(j.body.ticket.ticketId, NAME, PHONE);
    const cookie = await barberCookieFor(salonId);

    await joinViaApi(salonId);
    expect((await request(app).post('/api/barber/queue/next').set('Cookie', cookie)).status).toBe(200);

    const mine = emitted.filter((e) => e.room === `salon:${salonId}`);
    expect(mine.length).toBeGreaterThanOrEqual(2); // one for the join, one for NEXT
    expect(mine.every((e) => e.event === 'queue:updated')).toBe(true);

    const text = JSON.stringify(mine);
    expect(text).not.toContain(NAME);
    expect(text).not.toContain(PHONE);
    for (const e of mine) {
      for (const entry of e.payload.entries) {
        expect(Object.keys(entry).sort()).toEqual(['id', 'status', 'tokenNumber']);
      }
    }

    const state = await getSanitizedQueueState(salonId);
    expect(JSON.stringify(state)).not.toContain(PHONE);
  });

  it('public HTTP responses never echo the name or phone', async () => {
    const salonId = await makeSalon();
    const join = await joinViaApi(salonId);
    const NAME = 'Zephyr Quillfeather';
    const PHONE = '9123450098';
    await plantLegacyPersonalData(join.body.ticket.ticketId, NAME, PHONE);

    expect(join.status).toBe(201);
    const { ticketId, accessToken } = join.body.ticket;

    const queue = await request(app).get(`/api/salons/${salonId}/queue`);
    expect(Object.keys(queue.body).sort()).toEqual(['currentToken', 'waitingCount']);

    const status = await request(app).get(`/api/queue-tickets/${ticketId}`).query({ accessToken });
    expect(status.status).toBe(200);

    for (const body of [join.body, queue.body, status.body]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(PHONE);
    }
  });
});