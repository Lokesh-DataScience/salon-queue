// backend/tests/founderSalons.test.ts — Admin Slice 2: founder salon management.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, joinViaApi } from './helpers';
import { supabase } from '../src/config/supabase';

const PASSWORD = 'testpass123';
const extraSalons: string[] = [];
afterAll(async () => {
  if (extraSalons.length) await supabase.from('salons').delete().in('id', extraSalons);
  await cleanupSalons();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A staff account with a known email + password, signed in.
async function account(salonId: string) {
  const email = `fs-${randomUUID()}@example.test`;
  const { data, error } = await supabase
    .from('salon_staff')
    .insert({ salon_id: salonId, name: 'Test Owner', email, password_hash: await bcrypt.hash(PASSWORD, 4), role: 'OWNER' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const cookie = await login(email, PASSWORD);
  if (!cookie) throw new Error('login failed');
  return { staffId: data.id as string, email, cookie };
}

async function login(email: string, password: string) {
  const res = await request(app).post('/api/auth/barber/login').send({ email, password });
  if (res.status !== 200) return null;
  const lines = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  return lines.find((c) => c.startsWith('access_token=') && !c.startsWith('access_token=;'))?.split(';')[0] ?? null;
}

async function loginStatus(email: string, password: string) {
  return (await request(app).post('/api/auth/barber/login').send({ email, password })).status;
}

async function admin(role: 'FOUNDER' | 'SALES') {
  const salonId = await makeSalon({ is_internal: true });
  const a = await account(salonId);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: a.staffId, role });
  if (error) throw new Error(error.message);
  return { ...a, salonId };
}

const api = (cookie: string) => ({
  get: (p: string) => request(app).get(`/api/admin/founder${p}`).set('Cookie', cookie),
  post: (p: string, body: object) => request(app).post(`/api/admin/founder${p}`).set('Cookie', cookie).send(body),
  del: (p: string, body: object) => request(app).delete(`/api/admin/founder${p}`).set('Cookie', cookie).send(body),
});

async function auditCount(action: string, targetId: string) {
  const { count } = await supabase
    .from('admin_audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('action', action)
    .eq('target_id', targetId);
  return count ?? 0;
}

describe('Founder salon management (Slice 2)', () => {
  it('is FOUNDER only', async () => {
    const sales = await admin('SALES');
    expect((await api(sales.cookie).get('/salons')).status).toBe(404);
    expect((await api(sales.cookie).post(`/salons/${randomUUID()}/suspension`, { suspended: true })).status).toBe(404);
  }, 120_000);

  it('creates a salon (optionally internal), finds it by search, and its owner can sign in', async () => {
    const f = await admin('FOUNDER');
    const name = `Admin Created ${randomUUID().slice(0, 8)}`;
    const email = `created-${randomUUID()}@example.test`;
    const res = await api(f.cookie).post('/salons', {
      salonName: name,
      phone: '98765 43210',
      address: '12 Main Road, Korba',
      latitude: 22.35,
      longitude: 82.68,
      ownerName: 'New Owner',
      email,
      password: 'a-long-enough-pass',
      openingTime: '09:00',
      closingTime: '21:00',
      averageServiceMinutes: 15,
      isInternal: true,
    });
    expect(res.status).toBe(201);
    extraSalons.push(res.body.salonId);

    const list = await api(f.cookie).get(`/salons?search=${encodeURIComponent(name)}`);
    expect(list.status).toBe(200);
    expect(list.body.salons).toHaveLength(1);
    expect(list.body.salons[0]).toMatchObject({ name, isInternal: true, isSuspended: false });
    expect(list.body.salons[0].owner.email).toBe(email);

    expect(await loginStatus(email, 'a-long-enough-pass')).toBe(200);
    expect(await auditCount('salon.create', res.body.salonId)).toBe(1);
  }, 120_000);

  it('suspend: no new tickets, staff locked out, existing tickets kept; unsuspend restores', async () => {
    const f = await admin('FOUNDER');
    const salonId = await makeSalon();
    const owner = await account(salonId);
    const first = await joinViaApi(salonId);
    expect(first.status).toBe(201);

    expect((await api(f.cookie).post(`/salons/${salonId}/suspension`, { suspended: true })).status).toBe(200);

    // open session ends on the next request, and login explains why
    expect((await request(app).get('/api/barber/queue').set('Cookie', owner.cookie)).status).toBe(401);
    const loginRes = await request(app).post('/api/auth/barber/login').send({ email: owner.email, password: PASSWORD });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.message).toMatch(/paused/i);

    // customers can't take a new token
    const join = await joinViaApi(salonId);
    expect(join.status).toBe(409);
    expect(join.body.message).toBe('This salon is not taking bookings right now.');

    const { data: salon } = await supabase.from('salons').select('qr_code').eq('id', salonId).single();
    if (salon?.qr_code) {
      const scan = await request(app).get(`/api/salons/by-code/${salon.qr_code}`);
      expect(scan.status).toBe(409);
    }

    // the customer already waiting is untouched
    const { count: stillActive } = await supabase
      .from('queue_entries')
      .select('*', { count: 'exact', head: true })
      .eq('id', first.body.ticket.ticketId)
      .in('status', ['WAITING', 'CALLED', 'SERVING']);
    expect(stillActive).toBe(1);

    expect((await api(f.cookie).post(`/salons/${salonId}/suspension`, { suspended: false })).status).toBe(200);
    expect((await joinViaApi(salonId)).status).toBe(201);
    expect(await loginStatus(owner.email, PASSWORD)).toBe(200);
    expect(await auditCount('salon.suspend', salonId)).toBe(1);
    expect(await auditCount('salon.unsuspend', salonId)).toBe(1);
  }, 180_000);

  it('founder cannot suspend their own salon', async () => {
    const f = await admin('FOUNDER');
    expect((await api(f.cookie).post(`/salons/${f.salonId}/suspension`, { suspended: true })).status).toBe(409);
  }, 120_000);

  it('marks and unmarks a salon as internal', async () => {
    const f = await admin('FOUNDER');
    const salonId = await makeSalon();
    expect((await api(f.cookie).post(`/salons/${salonId}/internal`, { isInternal: true })).status).toBe(200);
    const { data } = await supabase.from('salons').select('is_internal').eq('id', salonId).single();
    expect(data?.is_internal).toBe(true);
    expect((await api(f.cookie).post(`/salons/${salonId}/internal`, { isInternal: false })).status).toBe(200);
  }, 120_000);

  it('password reset: needs the founder password, signs the barber out everywhere', async () => {
    const f = await admin('FOUNDER');
    const salonId = await makeSalon();
    const barber = await account(salonId);

    const wrong = await api(f.cookie).post(`/staff/${barber.staffId}/password`, {
      founderPassword: 'not-my-password',
      newPassword: 'brand-new-pass',
    });
    expect(wrong.status).toBe(403);
    expect((await request(app).get('/api/barber/me').set('Cookie', barber.cookie)).status).toBe(200);

    const ok = await api(f.cookie).post(`/staff/${barber.staffId}/password`, {
      founderPassword: PASSWORD,
      newPassword: 'brand-new-pass',
    });
    expect(ok.status).toBe(200);

    expect((await request(app).get('/api/barber/me').set('Cookie', barber.cookie)).status).toBe(401);
    expect(await loginStatus(barber.email, PASSWORD)).toBe(401);

    await sleep(1100); // a login in the same second as the reset counts as "before" it
    const fresh = await login(barber.email, 'brand-new-pass');
    expect(fresh).not.toBeNull();
    expect((await request(app).get('/api/barber/me').set('Cookie', fresh!)).status).toBe(200);

    const { data: log } = await supabase
      .from('admin_audit_log')
      .select('details')
      .eq('action', 'staff.password_reset')
      .eq('target_id', barber.staffId);
    expect(log).toHaveLength(1);
    expect(JSON.stringify(log)).not.toContain('brand-new-pass');
  }, 180_000);

  it('cannot reset its own password here', async () => {
    const f = await admin('FOUNDER');
    const res = await api(f.cookie).post(`/staff/${f.staffId}/password`, { founderPassword: PASSWORD, newPassword: 'whatever-123' });
    expect(res.status).toBe(400);
  }, 120_000);

  it('delete: internal salons only, exact name, never your own', async () => {
    const f = await admin('FOUNDER');
    const real = await makeSalon();
    expect((await api(f.cookie).del(`/salons/${real}`, { confirmName: 'TEST Salon (safe to delete)' })).status).toBe(409);

    const internal = await makeSalon({ is_internal: true, name: 'Delete Me Internal' });
    expect((await api(f.cookie).del(`/salons/${internal}`, { confirmName: 'wrong name' })).status).toBe(400);
    expect((await api(f.cookie).del(`/salons/${internal}`, { confirmName: 'Delete Me Internal' })).status).toBe(200);
    const { count } = await supabase.from('salons').select('*', { count: 'exact', head: true }).eq('id', internal);
    expect(count).toBe(0);
    expect(await auditCount('salon.delete', internal)).toBe(1);

    expect((await api(f.cookie).del(`/salons/${f.salonId}`, { confirmName: 'TEST Salon (safe to delete)' })).status).toBe(409);
  }, 180_000);
});
