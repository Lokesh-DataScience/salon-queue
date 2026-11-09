// backend/tests/lanes.test.ts
// Slice H against the real database: customers choose a barber, or "Any barber".
// Needs step9, step9b, step10 and step11 applied.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, customerDetails } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

type Ticket = { ticketId: string; accessToken: string; tokenNumber: number };

async function makeSalonWithLanes(extraBarbers = 1) {
  const salonId = await makeSalon({ average_service_minutes: 10 });
  const { data: def } = await supabase.from('lanes').select('id').eq('salon_id', salonId).eq('is_default', true).single();
  const barbers: string[] = [];
  for (let i = 0; i < extraBarbers; i++) {
    const { data, error } = await supabase
      .from('lanes')
      .insert({ salon_id: salonId, name: i === 0 ? 'Rahul' : `Barber ${i + 1}` })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    barbers.push(data!.id as string);
  }
  return { salonId, mainId: def!.id as string, rahulId: barbers[0], barbers };
}

const join = (salonId: string, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/queues/${salonId}/join`).send({ ...customerDetails(), ...body });

async function joinOk(salonId: string, body: Record<string, unknown> = {}): Promise<Ticket> {
  const res = await join(salonId, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.ticket as Ticket;
}

const statusOf = (t: Ticket) =>
  request(app).get(`/api/queue-tickets/${t.ticketId}`).set('X-Ticket-Token', t.accessToken);

async function laneOf(ticketId: string) {
  const { data } = await supabase.from('queue_entries').select('lane_id').eq('id', ticketId).single();
  return data!.lane_id as string;
}

describe('Customers choose a barber (Slice H)', () => {
  it('a one-barber salon works exactly as before: no choice needed, nothing extra shown', async () => {
    const salonId = await makeSalon();
    const { data: def } = await supabase.from('lanes').select('id').eq('salon_id', salonId).eq('is_default', true).single();

    const t = await joinOk(salonId);
    expect(await laneOf(t.ticketId)).toBe(def!.id);

    const s = await statusOf(t);
    expect(s.status).toBe(200);
    expect(s.body.ticket.lane).toBeNull(); // nobody to choose between, so no barber is named

    const lanes = await request(app).get(`/api/salons/${salonId}/lanes`);
    expect(lanes.status).toBe(200);
    expect(lanes.body.lanes).toHaveLength(1);
  }, 60_000);

  it('a customer can choose a barber, and the ticket names whose line it is', async () => {
    const { salonId, rahulId } = await makeSalonWithLanes();
    const t = await joinOk(salonId, { laneId: rahulId });
    expect(await laneOf(t.ticketId)).toBe(rahulId);

    const s = await statusOf(t);
    expect(s.body.ticket.lane).toEqual({ id: rahulId, name: 'Rahul' });
  }, 60_000);

  it('"Any barber" goes to the shorter line, and not just always the first one', async () => {
    const { salonId, mainId, rahulId } = await makeSalonWithLanes();
    await joinOk(salonId, { laneId: rahulId }); // starts at once
    await joinOk(salonId, { laneId: rahulId }); // waits behind them

    const any = await joinOk(salonId); // no laneId
    expect(await laneOf(any.ticketId)).toBe(mainId); // the owner's line is empty

    await joinOk(salonId, { laneId: mainId });
    await joinOk(salonId, { laneId: mainId });
    await joinOk(salonId, { laneId: mainId });
    const any2 = await joinOk(salonId); // now Rahul's line is the shorter one
    expect(await laneOf(any2.ticketId)).toBe(rahulId);
  }, 120_000);

  it('two barbers serve at the same time', async () => {
    const { salonId, rahulId } = await makeSalonWithLanes();
    const a = await joinOk(salonId); // Any -> the owner's empty line, starts at once
    const b = await joinOk(salonId, { laneId: rahulId });
    const sa = (await statusOf(a)).body.ticket;
    const sb = (await statusOf(b)).body.ticket;
    expect(sa.status).toBe('SERVING');
    expect(sb.status).toBe('SERVING');
  }, 60_000);

  it('people ahead, the wait, and "now serving" count only your own barber\'s line', async () => {
    const { salonId, mainId, rahulId } = await makeSalonWithLanes();
    const m1 = await joinOk(salonId, { laneId: mainId }); // serving in the owner's line
    const r1 = await joinOk(salonId, { laneId: rahulId }); // serving in Rahul's line
    await joinOk(salonId, { laneId: rahulId }); // waiting in Rahul's line
    await joinOk(salonId, { laneId: rahulId }); // waiting in Rahul's line
    const rLast = await joinOk(salonId, { laneId: rahulId });
    const mNext = await joinOk(salonId, { laneId: mainId });

    const inRahul = (await statusOf(rLast)).body.ticket;
    expect(inRahul.peopleAhead).toBe(2);
    expect(inRahul.estimatedWaitMinutes).toBeGreaterThanOrEqual(20); // serving remainder + two waiting
    expect(inRahul.currentToken).toBe(r1.tokenNumber); // Rahul's serving number, not the owner's

    const inMain = (await statusOf(mNext)).body.ticket;
    expect(inMain.peopleAhead).toBe(0); // the three people in Rahul's line are not ahead of this customer
    expect(inMain.estimatedWaitMinutes).toBeLessThanOrEqual(10);
    expect(inMain.currentToken).toBe(m1.tokenNumber);
  }, 120_000);

  it('token numbers are one unbroken sequence, even when customers join different barbers at once', async () => {
    const { salonId, mainId, rahulId } = await makeSalonWithLanes();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => join(salonId, { laneId: i % 2 ? rahulId : mainId })),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const tokens = results.map((r) => r.body.ticket.tokenNumber as number).sort((x, y) => x - y);
    expect(tokens).toEqual([1, 2, 3, 4, 5, 6]);
  }, 120_000);

  it("refuses another salon's barber, an unknown one, and a switched-off one", async () => {
    const a = await makeSalonWithLanes();
    const b = await makeSalonWithLanes();

    for (const laneId of [b.rahulId, randomUUID()]) {
      const res = await join(a.salonId, { laneId });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/isn't available/);
    }
    expect((await join(a.salonId, { laneId: 'not-a-uuid' })).status).toBe(400);

    await supabase.from('lanes').update({ is_active: false }).eq('id', a.rahulId);
    const off = await join(a.salonId, { laneId: a.rahulId });
    expect(off.status).toBe(409);
    // "Any barber" never lands in a switched-off line
    const any = await joinOk(a.salonId);
    expect(await laneOf(any.ticketId)).toBe(a.mainId);

    const { count } = await supabase.from('queue_entries').select('id', { count: 'exact', head: true }).eq('lane_id', b.rahulId);
    expect(count).toBe(0); // nothing leaked into the other salon's barber
  }, 120_000);

  it('a retried scan (same key) returns the same ticket, whichever barber the retry asks for', async () => {
    const { salonId, mainId, rahulId } = await makeSalonWithLanes();
    const clientKey = randomUUID().replace(/-/g, '');
    const d = customerDetails();
    const first = await joinOk(salonId, { ...d, clientKey, laneId: rahulId });
    const second = await joinOk(salonId, { ...d, clientKey, laneId: mainId });
    expect(second.ticketId).toBe(first.ticketId);
    expect(await laneOf(first.ticketId)).toBe(rahulId);
  }, 60_000);

  it('the public barber list shows only active barbers, with no staff details', async () => {
    const { salonId, rahulId } = await makeSalonWithLanes();
    const res = await request(app).get(`/api/salons/${salonId}/lanes`);
    expect(res.status).toBe(200);
    expect(res.body.lanes).toHaveLength(2);
    expect(res.body.lanes[0].name).toBe('Main'); // the owner's own line is listed first
    for (const l of res.body.lanes) {
      expect(Object.keys(l).sort()).toEqual(['estimatedWaitMinutes', 'id', 'isPaused', 'name', 'waitingCount']);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/phone|password|hash|salon_id|email/i);

    await supabase.from('lanes').update({ is_active: false }).eq('id', rahulId);
    expect((await request(app).get(`/api/salons/${salonId}/lanes`)).body.lanes).toHaveLength(1);
    expect((await request(app).get('/api/salons/not-a-uuid/lanes')).status).toBe(400);
  }, 60_000);
});
