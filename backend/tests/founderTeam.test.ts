// backend/tests/founderTeam.test.ts — Admin Slice 3: team (admin roles) and audit log.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

async function account(opts: { internal?: boolean } = {}) {
  const salonId = await makeSalon({ is_internal: opts.internal ?? false });
  const email = `team-${randomUUID()}@example.test`;
  const { data, error } = await supabase
    .from('salon_staff')
    .insert({ salon_id: salonId, name: 'Team Person', email, password_hash: await bcrypt.hash('testpass123', 4), role: 'OWNER' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const res = await request(app).post('/api/auth/barber/login').send({ email, password: 'testpass123' });
  const lines = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  const cookie = lines.find((c) => c.startsWith('access_token=') && !c.startsWith('access_token=;'))!.split(';')[0];
  return { salonId, staffId: data.id as string, email, cookie };
}

async function founder() {
  const a = await account({ internal: true });
  await supabase.from('staff_admin_roles').upsert({ staff_id: a.staffId, role: 'FOUNDER' });
  return a;
}

const api = (cookie: string) => ({
  get: (p: string) => request(app).get(`/api/admin/founder${p}`).set('Cookie', cookie),
  post: (p: string, b: object) => request(app).post(`/api/admin/founder${p}`).set('Cookie', cookie).send(b),
  del: (p: string) => request(app).delete(`/api/admin/founder${p}`).set('Cookie', cookie),
});

describe('Team and audit log (Slice 3)', () => {
  it('founder gives SALES by email, changes it to TECH, then removes it — each takes effect at once', async () => {
    const f = await founder();
    const partner = await account();

    const grant = await api(f.cookie).post('/team', { identifier: partner.email.toUpperCase(), role: 'SALES' });
    expect(grant.status).toBe(201);
    expect((await request(app).get('/api/admin/sales').set('Cookie', partner.cookie)).status).toBe(200);

    // their salon is marked internal by default
    const { data: salon } = await supabase.from('salons').select('is_internal').eq('id', partner.salonId).single();
    expect(salon?.is_internal).toBe(true);

    const team = await api(f.cookie).get('/team');
    const row = team.body.admins.find((a: { staffId: string }) => a.staffId === partner.staffId);
    expect(row).toMatchObject({ role: 'SALES', email: partner.email, isYou: false });
    expect(team.body.admins.find((a: { staffId: string }) => a.staffId === f.staffId)).toMatchObject({ role: 'FOUNDER', isYou: true });

    expect((await api(f.cookie).post('/team', { identifier: partner.email, role: 'TECH' })).status).toBe(201);
    expect((await request(app).get('/api/admin/sales').set('Cookie', partner.cookie)).status).toBe(404);
    expect((await request(app).get('/api/admin/tech').set('Cookie', partner.cookie)).status).toBe(200);

    expect((await api(f.cookie).del(`/team/${partner.staffId}`)).status).toBe(200);
    expect((await request(app).get('/api/admin/me').set('Cookie', partner.cookie)).status).toBe(404);
  }, 180_000);

  it('can leave the salon real when asked', async () => {
    const f = await founder();
    const p = await account();
    await api(f.cookie).post('/team', { identifier: p.email, role: 'TECH', markSalonInternal: false });
    const { data } = await supabase.from('salons').select('is_internal').eq('id', p.salonId).single();
    expect(data?.is_internal).toBe(false);
  }, 120_000);

  it('refuses FOUNDER grants, self-changes, other founders and unknown accounts', async () => {
    const f = await founder();
    const other = await founder();

    expect((await api(f.cookie).post('/team', { identifier: other.email, role: 'FOUNDER' })).status).toBe(400);
    expect((await api(f.cookie).post('/team', { identifier: f.email, role: 'SALES' })).status).toBe(409);
    expect((await api(f.cookie).del(`/team/${f.staffId}`)).status).toBe(409);
    expect((await api(f.cookie).post('/team', { identifier: other.email, role: 'SALES' })).status).toBe(409);
    expect((await api(f.cookie).del(`/team/${other.staffId}`)).status).toBe(409);
    expect((await api(f.cookie).post('/team', { identifier: `nobody-${randomUUID()}@example.test`, role: 'SALES' })).status).toBe(404);
    expect((await api(f.cookie).del(`/team/${randomUUID()}`)).status).toBe(404);
  }, 120_000);

  it('team and audit are FOUNDER only', async () => {
    const s = await account({ internal: true });
    await supabase.from('staff_admin_roles').upsert({ staff_id: s.staffId, role: 'SALES' });
    expect((await api(s.cookie).get('/team')).status).toBe(404);
    expect((await api(s.cookie).get('/audit')).status).toBe(404);
  }, 120_000);

  it('audit log lists actions newest first, with who did them, filters by group and pages', async () => {
    const f = await founder();
    const p = await account();
    await api(f.cookie).post('/team', { identifier: p.email, role: 'SALES' });
    await api(f.cookie).del(`/team/${p.staffId}`);

    const res = await api(f.cookie).get('/audit?group=admin');
    expect(res.status).toBe(200);
    const mine = res.body.entries.filter((e: { targetId: string }) => e.targetId === p.staffId);
    expect(mine.map((e: { action: string }) => e.action)).toEqual(['admin.revoke', 'admin.grant']);
    expect(mine[0].actor).toMatchObject({ email: f.email, role: 'FOUNDER' });
    expect(res.body.entries.every((e: { action: string }) => e.action.startsWith('admin.'))).toBe(true);

    const first = res.body.entries[0].id as number;
    const older = await api(f.cookie).get(`/audit?group=admin&before=${first}`);
    expect(older.status).toBe(200);
    expect(older.body.entries.every((e: { id: number }) => e.id < first)).toBe(true);

    expect((await api(f.cookie).get('/audit?group=nope')).status).toBe(400);
  }, 120_000);
});
