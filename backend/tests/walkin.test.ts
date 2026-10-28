// backend/tests/walkin.test.ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { supabase } from '../src/config/supabase';

const app = createApp({ rateLimits: false });

type Barber = { agent: ReturnType<typeof request.agent>; salonId: string };

const salonIds: string[] = [];
let counter = 0;

async function newBarber(label: string): Promise<Barber> {
  counter += 1;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/barber/register').send({
    salonName: `Walkin Test ${label} ${Date.now()}`,
    phone: '9876543210',
    address: 'Test Road, Korba, Chhattisgarh',
    latitude: 22.35,
    longitude: 82.68,
    ownerName: 'Walkin Tester',
    email: `walkin-${label}-${Date.now()}-${counter}@test.local`,
    password: 'testpass123',
    openingTime: '00:00',
    closingTime: '23:59',
    averageServiceMinutes: 20,
  });
  expect([200, 201], `register failed: ${JSON.stringify(res.body)}`).toContain(res.status);
  const salonId = res.body.staff.salonId as string;
  salonIds.push(salonId);
  return { agent, salonId };
}

const walkIn = (b: Barber) => b.agent.post('/api/barber/queue/walk-in').send({});

async function entryRow(entryId: string) {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('id, token_number, status, is_walk_in, offer_id, prize_code, customer_name, customer_phone, queues!inner(salon_id)')
    .eq('id', entryId)
    .single();
  if (error) throw error;
  return data as any;
}

async function normalJoin(salonId: string) {
  const { data, error } = await supabase.rpc('join_queue', { p_salon_id: salonId });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { entry_id: string; token_number: number };
}

afterAll(async () => {
  for (const id of salonIds) {
    await supabase.from('salon_staff').delete().eq('salon_id', id);
    await supabase.from('salons').delete().eq('id', id); // queues/entries/offers cascade
  }
});

describe('barber walk-in (+1)', () => {
  let A: Barber;
  let lastToken = 0; // last token issued in salon A

  beforeAll(async () => {
    A = await newBarber('a');
  }, 60_000);

  it('requires a logged-in barber', async () => {
    const res = await request(app).post('/api/barber/queue/walk-in').send({});
    expect(res.status).toBe(401);
  });

  it('adds a walk-in as the next token, flagged and with no personal data', async () => {
    const res = await walkIn(A);
    expect(res.status).toBe(201);
    expect(res.body.entry.tokenNumber).toBe(1);
    lastToken = 1;

    const row = await entryRow(res.body.entry.id);
    expect(row.status).toBe('WAITING');
    expect(row.is_walk_in).toBe(true);
    expect(row.customer_name).toBeNull();
    expect(row.customer_phone).toBeNull();

    const snap = await A.agent.get('/api/barber/queue');
    expect(snap.body.waiting.map((e: any) => e.token_number)).toContain(1);
  });

  it('two simultaneous +1 taps get different, consecutive tokens', async () => {
    const [r1, r2] = await Promise.all([walkIn(A), walkIn(A)]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const tokens = [r1.body.entry.tokenNumber, r2.body.entry.tokenNumber].sort((x, y) => x - y);
    expect(tokens[0]).toBe(lastToken + 1);
    expect(tokens[1]).toBe(lastToken + 2);
    lastToken += 2;
  });

  it('shares one token sequence with customers who join by QR', async () => {
    const joined = await normalJoin(A.salonId);
    expect(joined.token_number).toBe(lastToken + 1);
    lastToken += 1;

    const res = await walkIn(A);
    expect(res.status).toBe(201);
    expect(res.body.entry.tokenNumber).toBe(lastToken + 1);
    lastToken += 1;
  });

  it('never draws a prize for a walk-in (but a normal join still can)', async () => {
    // One offer with plenty of daily stock: a normal join always wins it.
    const { data: offer, error } = await supabase
      .from('salon_offers')
      .insert({ salon_id: A.salonId, name: 'Head massage', daily_count: 50 })
      .select('id')
      .single();
    if (error) throw error;

    const customer = await normalJoin(A.salonId);
    lastToken += 1;
    const customerRow = await entryRow(customer.entry_id);
    expect(customerRow.prize_code).not.toBeNull(); // proves the draw is live

    const stockBefore = await supabase.from('offer_daily_stock').select('remaining').eq('offer_id', offer.id).single();

    const res = await walkIn(A);
    expect(res.status).toBe(201);
    lastToken += 1;
    const walkRow = await entryRow(res.body.entry.id);
    expect(walkRow.offer_id).toBeNull();
    expect(walkRow.prize_code).toBeNull();

    const stockAfter = await supabase.from('offer_daily_stock').select('remaining').eq('offer_id', offer.id).single();
    expect(stockAfter.data?.remaining).toBe(stockBefore.data?.remaining); // prize stock untouched
  });

  it('is refused while the queue is paused, and works again after resume', async () => {
    expect((await A.agent.post('/api/barber/queue/pause')).status).toBe(200);

    const blocked = await walkIn(A);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/paused/i);

    expect((await A.agent.post('/api/barber/queue/resume')).status).toBe(200);
    const ok = await walkIn(A);
    expect(ok.status).toBe(201);
    expect(ok.body.entry.tokenNumber).toBe(lastToken + 1);
    lastToken += 1;
  });

  it('is refused when the salon is closed', async () => {
    await supabase.from('salons').update({ is_open: false }).eq('id', A.salonId);
    const res = await walkIn(A);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/closed/i);
    await supabase.from('salons').update({ is_open: true }).eq('id', A.salonId);
  });

  it('always uses the salon from the session, never one sent in the body', async () => {
    const B = await newBarber('b');
    const before = await A.agent.get('/api/barber/queue');

    // B tries to push a walk-in into A's queue by sending A's salonId.
    const res = await B.agent.post('/api/barber/queue/walk-in').send({ salonId: A.salonId });
    expect(res.status).toBe(201);

    const row = await entryRow(res.body.entry.id);
    expect(row.queues.salon_id).toBe(B.salonId);

    const after = await A.agent.get('/api/barber/queue');
    expect(after.body.waiting.length).toBe(before.body.waiting.length);
  }, 60_000);

  it('a walk-in goes through NEXT → START → COMPLETE like any other ticket', async () => {
    const C = await newBarber('c');
    const added = await walkIn(C);
    expect(added.status).toBe(201);
    const id = added.body.entry.id as string;

    const next = await C.agent.post('/api/barber/queue/next');
    expect(next.status).toBe(200);
    expect(next.body.result.called_entry_id).toBe(id);

    expect((await C.agent.post(`/api/barber/queue/${id}/start`)).status).toBe(200);
    expect((await C.agent.post(`/api/barber/queue/${id}/complete`)).status).toBe(200);

    expect((await entryRow(id)).status).toBe('COMPLETED');
  }, 60_000);
});