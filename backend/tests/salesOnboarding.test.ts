// backend/tests/salesOnboarding.test.ts — Admin Slice 5: onboarding funnel.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'crypto';
import { app, makeSalon, cleanupSalons, barberCookieFor, joinViaApi } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function admin(role: 'SALES' | 'TECH') {
  const cookie = await barberCookieFor(await makeSalon({ is_internal: true }));
  const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role });
  if (error) throw new Error(error.message);
  return cookie;
}

async function noServices(salonId: string) {
  await supabase.from('salon_services').delete().eq('salon_id', salonId); // in case a default-services trigger exists
}
async function addService(salonId: string) {
  const { error } = await supabase.from('salon_services').insert({ salon_id: salonId, name: 'Hair cut', duration_minutes: 15 });
  if (error) throw new Error(error.message);
}
async function walkInOnly(salonId: string, daysBack: number) {
  const when = daysAgo(daysBack);
  const { data: q, error } = await supabase
    .from('queues')
    .insert({ salon_id: salonId, date: when.slice(0, 10), current_token: 1, next_token: 2, status: 'ACTIVE' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from('queue_entries').insert({
    queue_id: q.id, token_number: 1, status: 'COMPLETED', joined_at: when, completed_at: when,
    access_token: randomBytes(32).toString('hex'), is_walk_in: true,
  });
  if (e2) throw new Error(e2.message);
}

const funnel = async (cookie: string, period = 'all') => {
  const res = await request(app).get(`/api/admin/sales/onboarding?period=${period}`).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body;
};

describe('Onboarding funnel (Slice 5)', () => {
  it('is for SALES and FOUNDER only', async () => {
    const tech = await admin('TECH');
    expect((await request(app).get('/api/admin/sales/onboarding').set('Cookie', tech)).status).toBe(404);
  }, 120_000);

  it('places each salon at the first step it has not done, and skips internal salons', async () => {
    const sales = await admin('SALES');

    const justRegistered = await makeSalon({ created_at: daysAgo(3) });
    await noServices(justRegistered);

    const walkInsOnly = await makeSalon({ created_at: daysAgo(12) });
    await noServices(walkInsOnly);
    await addService(walkInsOnly);
    await walkInOnly(walkInsOnly, 9);

    const quietAfterQr = await makeSalon({ created_at: daysAgo(30) });
    await addService(quietAfterQr);
    expect((await joinViaApi(quietAfterQr)).status).toBe(201);
    // move that ticket to 20 days ago, so the salon is no longer active
    const { data: qs } = await supabase.from('queues').select('id').eq('salon_id', quietAfterQr);
    await supabase.from('queue_entries').update({ joined_at: daysAgo(20) }).in('queue_id', (qs ?? []).map((q) => q.id));

    const allDone = await makeSalon({ created_at: daysAgo(10) });
    await addService(allDone);
    expect((await joinViaApi(allDone)).status).toBe(201);

    const fresh = await makeSalon(); // registered today with everything but too new to judge "active"
    await addService(fresh);
    expect((await joinViaApi(fresh)).status).toBe(201);

    const internal = await makeSalon({ is_internal: true });

    const body = await funnel(sales);
    const at = (id: string) => body.salons.find((s: { id: string }) => s.id === id);

    expect(at(justRegistered).nextStep).toBe('services');
    expect(at(walkInsOnly).nextStep).toBe('first_qr');
    expect(at(walkInsOnly).reached).toMatchObject({ services: true, first_ticket: true, first_qr: false });
    expect(at(quietAfterQr).nextStep).toBe('active');
    expect(at(allDone).nextStep).toBeNull();
    expect(at(allDone).reached.active).toBe(true);
    expect(at(fresh)).toMatchObject({ nextStep: null, eligibleForActive: false });
    expect(at(internal)).toBeUndefined();

    expect(body.steps.map((s: { id: string }) => s.id)).toEqual(['services', 'first_ticket', 'first_qr', 'active']);
    const active = body.steps.find((s: { id: string }) => s.id === 'active');
    expect(active.outOf).toBeLessThan(body.registered); // salons under 7 days old aren't judged yet
    expect(typeof body.medianDaysToFirstTicket).toBe('number');
    expect(JSON.stringify(body)).not.toContain('Test Customer');
  }, 240_000);

  it('limits to salons registered in the chosen period', async () => {
    const sales = await admin('SALES');
    const old = await makeSalon({ created_at: daysAgo(45) });
    expect((await funnel(sales, '30')).salons.some((s: { id: string }) => s.id === old)).toBe(false);
    expect((await funnel(sales, '90')).salons.some((s: { id: string }) => s.id === old)).toBe(true);
    expect((await request(app).get('/api/admin/sales/onboarding?period=7').set('Cookie', sales)).status).toBe(400);
  }, 120_000);
});
