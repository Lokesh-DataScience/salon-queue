// backend/tests/admin.test.ts — Admin Slice 0: access control for the in-app admin pages.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';

type Role = 'FOUNDER' | 'SALES' | 'TECH';
const SECTIONS = ['founder', 'sales', 'tech'] as const;

const extraSalons: string[] = [];
afterAll(async () => {
  if (extraSalons.length) await supabase.from('salons').delete().in('id', extraSalons);
  await cleanupSalons(); // staff + their admin rows cascade away
});

const get = (path: string, cookie?: string) => {
  const r = request(app).get(path);
  return cookie ? r.set('Cookie', cookie) : r;
};

async function staffIdOf(cookie: string) {
  const res = await get('/api/barber/me', cookie);
  expect(res.status).toBe(200);
  return res.body.staff.id as string;
}

async function grant(staffId: string, role: Role) {
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: staffId, role });
  if (error) throw new Error(`grant failed: ${error.message}`);
}

// A fresh salon + owner account, optionally made an admin.
async function account(role?: Role) {
  const salonId = await makeSalon();
  const cookie = await barberCookieFor(salonId);
  const staffId = await staffIdOf(cookie);
  if (role) await grant(staffId, role);
  return { salonId, cookie, staffId };
}

describe('Admin access (Slice 0)', () => {
  it('requires a signed-in session', async () => {
    expect((await get('/api/admin/me')).status).toBe(401);
    expect((await get('/api/admin/sales')).status).toBe(401);
  });

  it('a normal barber gets 404 on every admin route', async () => {
    const { cookie } = await account();
    const me = await get('/api/admin/me', cookie);
    expect(me.status).toBe(404);
    expect(me.body).toEqual({ message: 'Not found.' });
    for (const s of SECTIONS) expect((await get(`/api/admin/${s}`, cookie)).status).toBe(404);
  });

  it('SALES sees only the sales section', async () => {
    const { cookie } = await account('SALES');
    const me = await get('/api/admin/me', cookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ role: 'SALES', sections: ['sales'] });
    expect((await get('/api/admin/sales', cookie)).status).toBe(200);
    expect((await get('/api/admin/founder', cookie)).status).toBe(404);
    expect((await get('/api/admin/tech', cookie)).status).toBe(404);
  });

  it('TECH sees only the tech section', async () => {
    const { cookie } = await account('TECH');
    expect((await get('/api/admin/me', cookie)).body).toEqual({ role: 'TECH', sections: ['tech'] });
    expect((await get('/api/admin/tech', cookie)).status).toBe(200);
    expect((await get('/api/admin/founder', cookie)).status).toBe(404);
    expect((await get('/api/admin/sales', cookie)).status).toBe(404);
  });

  it('FOUNDER sees every section', async () => {
    const { cookie } = await account('FOUNDER');
    expect((await get('/api/admin/me', cookie)).body).toEqual({
      role: 'FOUNDER',
      sections: ['founder', 'sales', 'tech'],
    });
    for (const s of SECTIONS) expect((await get(`/api/admin/${s}`, cookie)).status).toBe(200);
  });

  it('removing the role row cuts access on the next request, same session', async () => {
    const { cookie, staffId } = await account('SALES');
    expect((await get('/api/admin/sales', cookie)).status).toBe(200);

    await supabase.from('staff_admin_roles').delete().eq('staff_id', staffId);

    expect((await get('/api/admin/sales', cookie)).status).toBe(404);
    expect((await get('/api/admin/me', cookie)).status).toBe(404);
  });

  it('granting a role works without logging in again', async () => {
    const { cookie, staffId } = await account();
    expect((await get('/api/admin/me', cookie)).status).toBe(404);
    await grant(staffId, 'TECH');
    expect((await get('/api/admin/me', cookie)).status).toBe(200);
  });

  it('the salon profile endpoint cannot make anyone an admin or internal', async () => {
    const { cookie, staffId, salonId } = await account();
    await request(app)
      .patch('/api/barber/salon')
      .set('Cookie', cookie)
      .send({ role: 'FOUNDER', adminRole: 'FOUNDER', isInternal: true, is_internal: true });

    const { data: roleRow } = await supabase.from('staff_admin_roles').select('role').eq('staff_id', staffId).maybeSingle();
    expect(roleRow).toBeNull();
    const { data: salon } = await supabase.from('salons').select('is_internal').eq('id', salonId).single();
    expect(salon?.is_internal).toBe(false);
    expect((await get('/api/admin/me', cookie)).status).toBe(404);
  });

  it('registering a salon cannot make anyone an admin or internal', async () => {
    const res = await request(app)
      .post('/api/auth/barber/register')
      .send({
        salonName: 'Admin Escalation Test',
        phone: '98765 43210',
        address: '12 Main Road, Korba',
        latitude: 22.35,
        longitude: 82.68,
        ownerName: 'Test Owner',
        email: `adm-${randomUUID()}@example.test`,
        password: 'a-long-enough-pass',
        role: 'FOUNDER',
        adminRole: 'FOUNDER',
        isInternal: true,
      });

    if (res.status === 201) {
      extraSalons.push(res.body.staff.salonId);
      const { data: roleRow } = await supabase
        .from('staff_admin_roles').select('role').eq('staff_id', res.body.staff.id).maybeSingle();
      expect(roleRow).toBeNull();
      const { data: salon } = await supabase
        .from('salons').select('is_internal').eq('id', res.body.staff.salonId).single();
      expect(salon?.is_internal).toBe(false);
      expect(res.body.staff.role).toBe('OWNER');
    } else {
      expect(res.status).toBe(400); // strict validator rejecting the extra fields is also fine
    }
  });

  it('the database refuses an unknown role', async () => {
    const { staffId } = await account();
    const { error } = await supabase.from('staff_admin_roles').insert({ staff_id: staffId, role: 'ADMIN' });
    expect(error).not.toBeNull();
  });
});
