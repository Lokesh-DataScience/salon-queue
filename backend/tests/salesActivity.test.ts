// backend/tests/salesActivity.test.ts — Admin Slice 4: Sales tab.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, barberCookieFor, joinViaApi } from './helpers';
import { supabase } from '../src/config/supabase';
import { assignPlaceToSalon } from '../src/services/place.service';

afterAll(cleanupSalons);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function admin(role: 'SALES' | 'TECH' | 'FOUNDER') {
  const salonId = await makeSalon({ is_internal: true });
  const cookie = await barberCookieFor(salonId);
  const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role });
  if (error) throw new Error(error.message);
  return cookie;
}

const activity = async (cookie: string) => {
  const res = await request(app).get('/api/admin/sales/activity').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body as {
    salons: Array<Record<string, any>>;
    areas: Array<{ area: string; salons: number; activeSalons7d: number; ticketsThisMonth: number }>;
  };
};

// A finished ticket on a past day (straight into the tables; the API only creates "now" tickets).
async function pastTicket(salonId: string, daysBack: number) {
  const when = daysAgo(daysBack);
  const { data: q, error: qErr } = await supabase
    .from('queues')
    .insert({ salon_id: salonId, date: when.slice(0, 10), current_token: 1, next_token: 2, status: 'ACTIVE' })
    .select('id')
    .single();
  if (qErr) throw new Error(qErr.message);
  const { error } = await supabase.from('queue_entries').insert({
    queue_id: q.id,
    token_number: 1,
    status: 'COMPLETED',
    joined_at: when,
    completed_at: when,
    access_token: randomBytes(32).toString('hex'),
  });
  if (error) throw new Error(error.message);
}

describe('Sales activity (Slice 4)', () => {
  it('is for SALES and FOUNDER only', async () => {
    const tech = await admin('TECH');
    expect((await request(app).get('/api/admin/sales/activity').set('Cookie', tech)).status).toBe(404);
    const normal = await barberCookieFor(await makeSalon({ is_internal: true }));
    expect((await request(app).get('/api/admin/sales/activity').set('Cookie', normal)).status).toBe(404);
    const founder = await admin('FOUNDER');
    expect((await request(app).get('/api/admin/sales/activity').set('Cookie', founder)).status).toBe(200);
  }, 120_000);

  it('shows activity, owner contact, area — and never internal salons', async () => {
    const sales = await admin('SALES');
    const district = `Testpur-${randomUUID().slice(0, 6)}`;

    const busy = await makeSalon({ name: `Busy ${district}` });
    await assignPlaceToSalon(busy, { district, state: 'Chhattisgarh' });
    await barberCookieFor(busy); // creates the OWNER account
    for (let i = 0; i < 2; i++) expect((await joinViaApi(busy)).status).toBe(201);

    const internal = await makeSalon({ is_internal: true, name: `Hidden ${district}` });
    expect((await joinViaApi(internal)).status).toBe(201);

    const body = await activity(sales);
    const row = body.salons.find((s) => s.id === busy);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ tickets7d: 2, ticketsThisMonth: 2, daysSinceLastTicket: 0, churnRisk: false });
    expect(row!.area).toBe(`${district}, Chhattisgarh`);
    expect(row!.owner.email).toMatch(/@example\.test$/);
    expect(body.salons.some((s) => s.id === internal)).toBe(false);

    const area = body.areas.find((a) => a.area === `${district}, Chhattisgarh`);
    expect(area).toEqual({ area: `${district}, Chhattisgarh`, salons: 1, activeSalons7d: 1, ticketsThisMonth: 2 });

    expect(JSON.stringify(body)).not.toContain('Test Customer'); // customer names never appear
  }, 180_000);

  it('flags churn risk: quiet 3+ days or never used; new salons are not flagged', async () => {
    const sales = await admin('SALES');
    const neverUsed = await makeSalon({ created_at: daysAgo(5) });
    const quiet = await makeSalon({ created_at: daysAgo(10) });
    await pastTicket(quiet, 4);
    const brandNew = await makeSalon(); // registered today, no tickets yet

    const { salons } = await activity(sales);
    const get = (id: string) => salons.find((s) => s.id === id)!;
    expect(get(neverUsed)).toMatchObject({ churnRisk: true, daysSinceLastTicket: null, lastTicketAt: null });
    expect(get(quiet)).toMatchObject({ churnRisk: true, daysSinceLastTicket: 4, tickets7d: 1 });
    expect(get(brandNew)).toMatchObject({ churnRisk: false });

    // churn-risk salons come first
    const firstSafe = salons.findIndex((s) => !s.churnRisk);
    const lastRisk = salons.map((s) => s.churnRisk).lastIndexOf(true);
    expect(firstSafe === -1 || lastRisk < firstSafe).toBe(true);
  }, 180_000);

  it('saves the partner flag and notes, with an audit record', async () => {
    const sales = await admin('SALES');
    const salonId = await makeSalon();

    const res = await request(app)
      .patch(`/api/admin/sales/salons/${salonId}/info`)
      .set('Cookie', sales)
      .send({ isPartner: true, notes: 'Called on Monday, wants a demo.' });
    expect(res.status).toBe(200);

    const row = (await activity(sales)).salons.find((s) => s.id === salonId)!;
    expect(row).toMatchObject({ isPartner: true, notes: 'Called on Monday, wants a demo.' });

    // notes only: partner flag kept
    await request(app).patch(`/api/admin/sales/salons/${salonId}/info`).set('Cookie', sales).send({ notes: 'Done.' });
    expect((await activity(sales)).salons.find((s) => s.id === salonId)).toMatchObject({ isPartner: true, notes: 'Done.' });

    const { count } = await supabase
      .from('admin_audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'sales.update_info')
      .eq('target_id', salonId);
    expect(count).toBe(2);

    const tooLong = await request(app)
      .patch(`/api/admin/sales/salons/${salonId}/info`)
      .set('Cookie', sales)
      .send({ notes: 'x'.repeat(2001) });
    expect(tooLong.status).toBe(400);
    const empty = await request(app).patch(`/api/admin/sales/salons/${salonId}/info`).set('Cookie', sales).send({});
    expect(empty.status).toBe(400);
    const missing = await request(app)
      .patch(`/api/admin/sales/salons/${randomUUID()}/info`)
      .set('Cookie', sales)
      .send({ isPartner: true });
    expect(missing.status).toBe(404);
  }, 180_000);
});
