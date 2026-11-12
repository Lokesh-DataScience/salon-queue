// backend/tests/founderOverview.test.ts — Admin Slice 1: founder numbers.
// Works on deltas (after − before), so other data in the tests project doesn't matter.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor, joinViaApi } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const get = (path: string, cookie: string) => request(app).get(path).set('Cookie', cookie);

async function staffIdOf(cookie: string) {
  const res = await get('/api/barber/me', cookie);
  expect(res.status).toBe(200);
  return res.body.staff.id as string;
}

// An admin account whose own salon is internal, so it never moves the numbers.
async function adminCookie(role: 'FOUNDER' | 'SALES') {
  const salonId = await makeSalon({ is_internal: true });
  const cookie = await barberCookieFor(salonId);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: await staffIdOf(cookie), role });
  if (error) throw new Error(error.message);
  return cookie;
}

async function overview(cookie: string) {
  const res = await get('/api/admin/founder/overview', cookie);
  expect(res.status).toBe(200);
  return res.body.overview;
}

async function completeOneEntry(salonId: string) {
  const { data: queues } = await supabase.from('queues').select('id').eq('salon_id', salonId);
  const queueIds = (queues ?? []).map((q) => q.id);
  const { data: entries } = await supabase.from('queue_entries').select('id').in('queue_id', queueIds).limit(1);
  const id = entries?.[0]?.id;
  if (!id) throw new Error('no entry to complete');
  const { error } = await supabase
    .from('queue_entries')
    .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

describe('GET /api/admin/founder/overview', () => {
  it('is FOUNDER only', async () => {
    const sales = await adminCookie('SALES');
    expect((await get('/api/admin/founder/overview', sales)).status).toBe(404);

    const normal = await barberCookieFor(await makeSalon({ is_internal: true }));
    expect((await get('/api/admin/founder/overview', normal)).status).toBe(404);
  }, 120_000);

  it('counts a real salon, its tickets, walk-ins and served — and ignores internal salons', async () => {
    const founder = await adminCookie('FOUNDER');
    const before = await overview(founder);

    // A real salon: 2 QR joins + 1 walk-in, then 1 of them completed.
    const realSalon = await makeSalon();
    for (let i = 0; i < 2; i++) expect((await joinViaApi(realSalon)).status).toBeLessThan(300);
    const owner = await barberCookieFor(realSalon);
    expect((await request(app).post('/api/barber/queue/walk-in').set('Cookie', owner)).status).toBe(201);
    await completeOneEntry(realSalon);

    // An internal salon with 2 joins: must not change anything.
    const internalSalon = await makeSalon({ is_internal: true });
    for (let i = 0; i < 2; i++) expect((await joinViaApi(internalSalon)).status).toBeLessThan(300);

    const after = await overview(founder);

    expect(after.salons.total - before.salons.total).toBe(1);
    expect(after.salons.newThisMonth - before.salons.newThisMonth).toBe(1);
    expect(after.salons.active7d - before.salons.active7d).toBe(1);

    for (const p of ['today', 'week', 'month'] as const) {
      expect(after.periods[p].tickets - before.periods[p].tickets).toBe(3);
      expect(after.periods[p].walkIn - before.periods[p].walkIn).toBe(1);
      expect(after.periods[p].qr - before.periods[p].qr).toBe(2);
      expect(after.periods[p].served - before.periods[p].served).toBe(1);
    }

    expect(after.days).toHaveLength(30);
    const lastBefore = before.days[before.days.length - 1];
    const lastAfter = after.days[after.days.length - 1];
    expect(lastAfter.date).toBe(after.today);
    expect(lastAfter.tickets - lastBefore.tickets).toBe(3);
    expect(lastAfter.served - lastBefore.served).toBe(1);
  }, 180_000);

  it('returns counts only — no names or phone numbers', async () => {
    const founder = await adminCookie('FOUNDER');
    const salonId = await makeSalon();
    await joinViaApi(salonId, { name: 'Leak Check Person', phone: '9123456780' });
    const body = JSON.stringify((await get('/api/admin/founder/overview', founder)).body);
    expect(body).not.toContain('Leak Check Person');
    expect(body).not.toContain('9123456780');
  }, 120_000);
});
