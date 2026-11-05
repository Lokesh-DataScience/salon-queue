// backend/tests/queueAutomation.test.ts
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';
import { todayISODate } from '../src/utils/date';
import { advanceQueue, extendEntry } from '../src/services/queueAutomation.service';
import { completeEntry } from '../src/services/barber.service';
import { sweepOnce } from '../src/jobs/queueSweeper';
import {
  setNotificationProvider,
  resetNotificationProvider,
  type NotificationEvent,
} from '../src/services/notification.service';
import { evaluateNotifications } from '../src/services/queueNotifications.service';
import { joinViaApi, app } from './helpers';
import request from 'supertest';
async function retried(
  run: () => PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>,
  label: string,
): Promise<{ id: string }> {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await run();
    if (!error && data) return data;
    last = error?.message ?? 'no data';
    if (!last.includes('fetch failed')) break; // real errors are not retried
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} failed: ${last}`);
}
afterAll(cleanupSalons);
afterEach(resetNotificationProvider);

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

async function makeQueue(salonId: string, date = todayISODate()) {
  const row = await retried(
    () =>
      supabase
        .from('queues')
        .insert({ salon_id: salonId, date, current_token: 0, next_token: 1, status: 'ACTIVE' })
        .select('id')
        .single(),
    'makeQueue',
  );
  return row.id as string;
}

async function addEntry(
  queueId: string,
  token: number,
  o: { status?: string; durationMinutes?: number | null; endsAt?: Date; startedAt?: Date } = {},
) {
  const row = await retried(
    () =>
      supabase
        .from('queue_entries')
        .insert({
          queue_id: queueId,
          token_number: token,
          status: o.status ?? 'WAITING',
          access_token: randomUUID(),
          joined_at: new Date().toISOString(),
          duration_minutes: o.durationMinutes ?? null,
          ends_at: o.endsAt?.toISOString() ?? null,
          started_at: o.startedAt?.toISOString() ?? null,
        })
        .select('id')
        .single(),
    'addEntry',
  );
  return row.id as string;
}

async function entry(id: string) {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('status, started_at, ends_at, completed_at, notified_stage')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`entry failed: ${error?.message}`);
  return data;
}

const makeDue = (id: string) =>
  supabase.from('queue_entries').update({ ends_at: ago(MIN).toISOString() }).eq('id', id);

describe('Queue automation (Slice 2)', () => {
  it('starts the first customer immediately', async () => {
    const salonId = await makeSalon();
    const q = await makeQueue(salonId);
    const a = await addEntry(q, 1, { durationMinutes: 10 });

    expect(await advanceQueue(salonId, q)).toBeGreaterThan(0);

    const e = await entry(a);
    expect(e.status).toBe('SERVING');
    expect((Date.parse(e.ends_at!) - Date.parse(e.started_at!)) / MIN).toBeCloseTo(10, 1);
    const { data: queue } = await supabase.from('queues').select('current_token').eq('id', q).single();
    expect(queue?.current_token).toBe(1);
  });

  it('chains the next customer from the previous end time, with no drift', async () => {
    const salonId = await makeSalon();
    const q = await makeQueue(salonId);
    const endsAt = ago(MIN);
    const a = await addEntry(q, 1, { status: 'SERVING', startedAt: ago(11 * MIN), endsAt });
    const b = await addEntry(q, 2, { durationMinutes: 15 });

    await advanceQueue(salonId, q);
    await evaluateNotifications(salonId);

    expect((await entry(a)).status).toBe('COMPLETED');
    const eb = await entry(b);
    expect(eb.status).toBe('SERVING');
    expect(Date.parse(eb.started_at!)).toBe(endsAt.getTime());
    expect((Date.parse(eb.ends_at!) - Date.parse(eb.started_at!)) / MIN).toBeCloseTo(15, 1);
  });

  it('uses the salon average when an entry has no duration (walk-ins)', async () => {
    const salonId = await makeSalon();
    const { data: salon } = await supabase
      .from('salons').select('average_service_minutes').eq('id', salonId).single();
    const q = await makeQueue(salonId);
    const a = await addEntry(q, 1, { durationMinutes: null });

    await advanceQueue(salonId, q);
    await evaluateNotifications(salonId);

    const e = await entry(a);
    expect((Date.parse(e.ends_at!) - Date.parse(e.started_at!)) / MIN)
      .toBeCloseTo(salon!.average_service_minutes, 1);
  });

  it('two simultaneous runs start only one customer', async () => {
    const salonId = await makeSalon();
    const q = await makeQueue(salonId);
    const a = await addEntry(q, 1, { durationMinutes: 10 });
    const b = await addEntry(q, 2, { durationMinutes: 10 });

    await Promise.all([advanceQueue(salonId, q), advanceQueue(salonId, q)]);

    expect([(await entry(a)).status, (await entry(b)).status]).toEqual(['SERVING', 'WAITING']);
  });

  it('two simultaneous runs complete a due customer exactly once', async () => {
    const salonId = await makeSalon();
    const q = await makeQueue(salonId);
    const a = await addEntry(q, 1, { status: 'SERVING', startedAt: ago(11 * MIN), endsAt: ago(MIN) });
    const b = await addEntry(q, 2, { durationMinutes: 10 });

    const results = await Promise.all([advanceQueue(salonId, q), advanceQueue(salonId, q)]);

    expect(results.sort()).toEqual([0, 2]); // one run did the work, the other found nothing
    expect([(await entry(a)).status, (await entry(b)).status]).toEqual(['COMPLETED', 'SERVING']);
  });

  it("never starts customers from a previous day's queue", async () => {
    const salonId = await makeSalon();
    const q = await makeQueue(salonId, '2000-01-01');
    const a = await addEntry(q, 1, { durationMinutes: 10 });

    await advanceQueue(salonId, q);

    expect((await entry(a)).status).toBe('WAITING');
  });

  it('Done early starts the next customer now, and a double tap cannot skip them', async () => {
    const salonId = await makeSalon();
    const q = await makeQueue(salonId);
    const a = await addEntry(q, 1, { status: 'SERVING', startedAt: ago(2 * MIN), endsAt: ahead(8 * MIN) });
    const b = await addEntry(q, 2, { durationMinutes: 5 });

    await completeEntry(salonId, a);
    await advanceQueue(salonId, q);

    const eb = await entry(b);
    expect(eb.status).toBe('SERVING');
    expect(Math.abs(Date.parse(eb.started_at!) - Date.now())).toBeLessThan(5000);

    await expect(completeEntry(salonId, a)).rejects.toThrow(); // second tap on the same entry
    expect((await entry(b)).status).toBe('SERVING');
  });

  it('+5 min extends the countdown, only for the owner and only while serving', async () => {
    const salonId = await makeSalon();
    const other = await makeSalon();
    const q = await makeQueue(salonId);
    const endsAt = ahead(10 * MIN);
    const a = await addEntry(q, 1, { status: 'SERVING', startedAt: ago(MIN), endsAt });
    const b = await addEntry(q, 2, { durationMinutes: 5 });

    const { endsAt: newEnd } = await extendEntry(salonId, a, 5);
    expect(Math.abs(Date.parse(newEnd) - (endsAt.getTime() + 5 * MIN))).toBeLessThan(1000);

    await expect(extendEntry(other, a, 5)).rejects.toThrow();
    await expect(extendEntry(salonId, b, 5)).rejects.toThrow(); // b is only waiting
  });

  it('notifies #4 three times as #1, #2 and #3 finish, and never twice', async () => {
    const sent: { event: NotificationEvent; token: number; ahead?: number }[] = [];
    setNotificationProvider({
      send: async (event, target, data) => {
        sent.push({ event, token: target.tokenNumber, ahead: data?.peopleAhead });
      },
    });

    const salonId = await makeSalon();
    const q = await makeQueue(salonId);
    const e1 = await addEntry(q, 1, { status: 'SERVING', startedAt: ago(11 * MIN), endsAt: ago(MIN) });
    const e2 = await addEntry(q, 2, { durationMinutes: 10 });
    const e3 = await addEntry(q, 3, { durationMinutes: 10 });
    await addEntry(q, 4, { durationMinutes: 10 });

    await advanceQueue(salonId, q); await evaluateNotifications(salonId); // #1 done, #2 starts
    await makeDue(e2);
    await advanceQueue(salonId, q); await evaluateNotifications(salonId); // #2 done, #3 starts
    await makeDue(e3);
    await advanceQueue(salonId, q); await evaluateNotifications(salonId); // #3 done, #4 starts
    await advanceQueue(salonId, q); await evaluateNotifications(salonId); // nothing changed, nothing sent
    expect((await entry(e1)).status).toBe('COMPLETED');

    const forFour = sent.filter((s) => s.token === 4).map((s) => [s.event, s.ahead]);
    expect(forFour).toEqual([
      ['QUEUE_APPROACHING', 2],
      ['QUEUE_APPROACHING', 1],
      ['TURN_NOW', undefined],
    ]);
  });

  it('a customer who jumps ahead hears only the latest stage', async () => {
    const sent: { event: NotificationEvent; token: number; ahead?: number }[] = [];
    setNotificationProvider({
      send: async (event, target, data) => {
        sent.push({ event, token: target.tokenNumber, ahead: data?.peopleAhead });
      },
    });

    const salonId = await makeSalon();
    const q = await makeQueue(salonId);
    await addEntry(q, 1, { status: 'SERVING', startedAt: ago(11 * MIN), endsAt: ago(MIN) });
    await addEntry(q, 2, { durationMinutes: 10 });
    await addEntry(q, 3, { status: 'CANCELLED' });
    await addEntry(q, 4, { status: 'CANCELLED' });
    await addEntry(q, 5, { durationMinutes: 10 });

    await advanceQueue(salonId, q); // #2 starts, #5 is now 1 ahead
    await evaluateNotifications(salonId);
    const forFive = sent.filter((s) => s.token === 5).map((s) => [s.event, s.ahead]);
    expect(forFive).toEqual([['QUEUE_APPROACHING', 1]]);
  });

  it('the sweeper completes due customers and starts the next one', async () => {
    const salonId = await makeSalon();
    const q = await makeQueue(salonId);
    const a = await addEntry(q, 1, { status: 'SERVING', startedAt: ago(11 * MIN), endsAt: ago(MIN) });
    const b = await addEntry(q, 2, { durationMinutes: 10 });

    expect(await sweepOnce([salonId])).toBeGreaterThan(0);

    expect([(await entry(a)).status, (await entry(b)).status]).toEqual(['COMPLETED', 'SERVING']);
  });
  it('joining through the API starts the first customer at once, and the second waits', async () => {
    const salonId = await makeSalon();
    const first = (await joinViaApi(salonId)).body.ticket;
    const second = (await joinViaApi(salonId)).body.ticket;

    const e1 = await entry(first.ticketId);
    expect(e1.status).toBe('SERVING');
    expect(e1.ends_at).not.toBeNull();
    expect((await entry(second.ticketId)).status).toBe('WAITING');
  });
  it('reading a ticket whose time is up completes it on the spot, without the sweeper', async () => {
    const salonId = await makeSalon();
    const q = await makeQueue(salonId);
    const a = await addEntry(q, 1, { status: 'SERVING', startedAt: ago(2 * MIN), endsAt: ago(1000) });
    const b = await addEntry(q, 2, { durationMinutes: 10 });
    const { data: tok } = await supabase.from('queue_entries').select('access_token').eq('id', a).single();

    const res = await request(app).get(`/api/queue-tickets/${a}`).set('X-Ticket-Token', tok!.access_token);

    expect(res.body.ticket.status).toBe('COMPLETED');
    expect((await entry(b)).status).toBe('SERVING');
  });
});