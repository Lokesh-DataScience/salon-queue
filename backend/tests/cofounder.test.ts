// backend/tests/cofounder.test.ts — Admin: Cofounder role.
// Sees everything, can use Sales and Tech, but can't change salons or the team.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const PASSWORD = 'testpass123';

async function account(opts: { internal?: boolean } = {}) {
  const salonId = await makeSalon({ is_internal: opts.internal ?? false });
  const email = `cof-${randomUUID()}@example.test`;
  const { data, error } = await supabase
    .from('salon_staff')
    .insert({ salon_id: salonId, name: 'Cof Person', email, password_hash: await bcrypt.hash(PASSWORD, 4), role: 'OWNER' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const res = await request(app).post('/api/auth/barber/login').send({ email, password: PASSWORD });
  const lines = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  const cookie = lines.find((c) => c.startsWith('access_token=') && !c.startsWith('access_token=;'))!.split(';')[0];
  return { salonId, staffId: data.id as string, email, cookie };
}

async function withRole(role: 'FOUNDER' | 'COFOUNDER') {
  const a = await account({ internal: true });
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: a.staffId, role });
  if (error) throw new Error(error.message);
  return a;
}

const api = (cookie: string) => ({
  get: (p: string) => request(app).get(`/api/admin${p}`).set('Cookie', cookie),
  post: (p: string, b: object = {}) => request(app).post(`/api/admin${p}`).set('Cookie', cookie).send(b),
  patch: (p: string, b: object = {}) => request(app).patch(`/api/admin${p}`).set('Cookie', cookie).send(b),
  del: (p: string, b: object = {}) => request(app).delete(`/api/admin${p}`).set('Cookie', cookie).send(b),
});

describe('Cofounder role', () => {
  it('sees every tab and every founder page', async () => {
    const c = await withRole('COFOUNDER');
    const salonId = await makeSalon();

    const me = await api(c.cookie).get('/me');
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('COFOUNDER');
    expect(me.body.sections).toEqual(['founder', 'sales', 'tech']);

    for (const p of ['/founder/overview', '/founder/salons', `/founder/salons/${salonId}`, '/founder/team', '/founder/audit', '/sales/activity', '/sales/leads', '/tech/flags', '/tech/bugs']) {
      const r = await api(c.cookie).get(p);
      expect(r.status, p).toBe(200);
    }
  }, 180_000);

  it('cannot change salons or the team, and nothing changes', async () => {
    const c = await withRole('COFOUNDER');
    const salonId = await makeSalon();
    const target = await account();

    const tries = [
      api(c.cookie).post('/founder/salons', { name: 'Should not exist' }),
      api(c.cookie).post(`/founder/salons/${salonId}/suspension`, { suspended: true }),
      api(c.cookie).post(`/founder/salons/${salonId}/internal`, { isInternal: true }),
      api(c.cookie).del(`/founder/salons/${salonId}`, { confirmName: 'TEST Salon (safe to delete)' }),
      api(c.cookie).post(`/founder/staff/${target.staffId}/password`, { founderPassword: PASSWORD, newPassword: 'changed-123' }),
      api(c.cookie).post('/founder/team', { identifier: target.email, role: 'SALES' }),
      api(c.cookie).del(`/founder/team/${target.staffId}`),
    ];
    for (const t of tries) {
      const r = await t;
      expect(r.status).toBe(403);
      expect(r.body.message).toBe('Only the founder can do this.');
    }

    const { data: salon } = await supabase.from('salons').select('is_suspended, is_internal').eq('id', salonId).single();
    expect(salon).toMatchObject({ is_suspended: false, is_internal: false });
    const { data: role } = await supabase.from('staff_admin_roles').select('role').eq('staff_id', target.staffId).maybeSingle();
    expect(role).toBeNull();
    const login = await request(app).post('/api/auth/barber/login').send({ email: target.email, password: PASSWORD });
    expect(login.status).toBe(200); // password untouched
  }, 180_000);

  it('can use the Sales tools (add and delete a lead)', async () => {
    const c = await withRole('COFOUNDER');
    const created = await api(c.cookie).post('/sales/leads', { name: `Cof Lead ${randomUUID().slice(0, 6)}` });
    expect(created.status).toBeLessThan(300);
    const id = (created.body.lead?.id ?? created.body.id) as string;
    expect(id).toBeTruthy();
    expect((await api(c.cookie).del(`/sales/leads/${id}`)).status).toBeLessThan(300);
  }, 120_000);

  it('the founder gives and removes Cofounder from the app; access follows at once', async () => {
    const f = await withRole('FOUNDER');
    const p = await account();

    const grant = await api(f.cookie).post('/founder/team', { identifier: p.email, role: 'COFOUNDER', markSalonInternal: false });
    expect(grant.status).toBe(201);
    expect((await api(p.cookie).get('/me')).body.role).toBe('COFOUNDER');
    expect((await api(p.cookie).get('/founder/overview')).status).toBe(200);

    expect((await api(f.cookie).del(`/founder/team/${p.staffId}`)).status).toBe(200);
    expect((await api(p.cookie).get('/me')).status).toBe(404);
    expect((await api(p.cookie).get('/founder/overview')).status).toBe(404);
  }, 180_000);

  it('Sales and Tech still cannot open the Founder tab', async () => {
    const s = await account({ internal: true });
    await supabase.from('staff_admin_roles').upsert({ staff_id: s.staffId, role: 'SALES' });
    expect((await api(s.cookie).get('/founder/overview')).status).toBe(404);
    expect((await api(s.cookie).get('/tech/flags')).status).toBe(404);
  }, 120_000);
});
