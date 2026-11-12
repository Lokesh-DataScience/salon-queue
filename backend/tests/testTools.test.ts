// backend/tests/testTools.test.ts — Admin Slice 11: testing tools and feature flags.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';
import { todayISODate } from '../src/utils/date';
import { clearFlagCache } from '../src/services/flags.service';

let savedNotice: { enabled: boolean; value: string } | null = null;
afterAll(async () => {
  if (savedNotice) await supabase.from('feature_flags').update(savedNotice).eq('key', 'barber_notice');
  clearFlagCache();
  await cleanupSalons();
});

async function admin(role: 'TECH' | 'SALES') {
  const cookie = await barberCookieFor(await makeSalon({ is_internal: true }));
  const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role });
  if (error) throw new Error(error.message);
  return cookie;
}

const tool = (cookie: string, salonId: string, name: string, body: object = {}) =>
  request(app).post(`/api/admin/tech/test/${salonId}/${name}`).set('Cookie', cookie).send(body);

async function entries(salonId: string) {
  const { data: q } = await supabase.from('queues').select('id').eq('salon_id', salonId).eq('date', todayISODate()).single();
  const { data } = await supabase
    .from('queue_entries')
    .select('id, token_number, status, access_token')
    .eq('queue_id', q!.id)
    .order('token_number');
  return data ?? [];
}

describe('Testing tools (Slice 11)', () => {
  it('only Tech/Founder, and only on internal salons', async () => {
    const realSalon = await makeSalon();
    const sales = await admin('SALES');
    expect((await request(app).get('/api/admin/tech/test-salons').set('Cookie', sales)).status).toBe(404);
    expect((await tool(sales, realSalon, 'scan')).status).toBe(404);

    const tech = await admin('TECH');
    const r = await tool(tech, realSalon, 'scan');
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/internal salons/);

    const { count } = await supabase
      .from('queue_entries')
      .select('id, queues!inner(salon_id)', { count: 'exact', head: true })
      .eq('queues.salon_id', realSalon);
    expect(count ?? 0).toBe(0);
  }, 120_000);

  it('scan, walk-in, finish, push and clear work on an internal salon and are audit-logged', async () => {
    const tech = await admin('TECH');
    const salonId = await makeSalon({ is_internal: true, name: 'TEST Tools Salon (safe to delete)' });

    const list = await request(app).get('/api/admin/tech/test-salons').set('Cookie', tech);
    expect(list.status).toBe(200);
    expect(list.body.salons.some((s: { id: string }) => s.id === salonId)).toBe(true);

    const scan = await tool(tech, salonId, 'scan');
    expect(scan.status).toBe(200);
    const walk = await tool(tech, salonId, 'walk-in');
    expect(walk.status).toBe(200);
    expect(walk.body.token).toBe(scan.body.token + 1);

    const rows = await entries(salonId);
    const first = rows.find((e) => e.token_number === scan.body.token)!;
    expect(scan.body.ticketUrl).toBe(`/tickets/${first.id}?accessToken=${first.access_token}`);

    // Make sure token 1 is being served (the app may already have started it).
    if (first.status !== 'SERVING') {
      await supabase
        .from('queue_entries')
        .update({ status: 'SERVING', ends_at: new Date(Date.now() + 10 * 60_000).toISOString() })
        .eq('id', first.id);
    }
    const fin = await tool(tech, salonId, 'finish', { token: scan.body.token });
    expect(fin.status).toBe(200);
    expect(fin.body.tokens).toEqual([scan.body.token]);
    const { data: after } = await supabase.from('queue_entries').select('status').eq('id', first.id).single();
    expect(after?.status).not.toBe('SERVING');
    expect((await tool(tech, salonId, 'finish', { token: 999 })).status).toBe(409);

    expect((await tool(tech, salonId, 'push', { token: 999 })).status).toBe(404);
    expect((await tool(tech, salonId, 'push', { token: walk.body.token })).status).toBe(409); // no notifications on
    expect((await tool(tech, salonId, 'push', {})).status).toBe(400);

    const clear = await tool(tech, salonId, 'clear');
    expect(clear.status).toBe(200);
    const left = (await entries(salonId)).filter((e) => ['WAITING', 'CALLED', 'SERVING'].includes(e.status));
    expect(left).toHaveLength(0);

    const { data: audit } = await supabase.from('admin_audit_log').select('action').eq('target_id', salonId);
    const actions = (audit ?? []).map((a) => a.action);
    for (const a of ['tech.test_scan', 'tech.test_walk_in', 'tech.test_finish', 'tech.test_clear']) {
      expect(actions).toContain(a);
    }
  }, 180_000);
});

describe('Feature flags (Slice 11)', () => {
  it('Tech changes a flag and the barber app sees it; bad input is refused', async () => {
    const { data: before } = await supabase.from('feature_flags').select('enabled, value').eq('key', 'barber_notice').single();
    savedNotice = before as { enabled: boolean; value: string };

    const sales = await admin('SALES');
    expect((await request(app).get('/api/admin/tech/flags').set('Cookie', sales)).status).toBe(404);

    const tech = await admin('TECH');
    const list = await request(app).get('/api/admin/tech/flags').set('Cookie', tech);
    expect(list.status).toBe(200);
    expect(list.body.flags.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(['barber_notice', 'bug_reports']));

    const upd = await request(app)
      .patch('/api/admin/tech/flags/barber_notice')
      .set('Cookie', tech)
      .send({ enabled: true, value: 'Test notice from flags test' });
    expect(upd.status).toBe(200);

    const barber = await barberCookieFor(await makeSalon());
    const seen = await request(app).get('/api/barber/flags').set('Cookie', barber);
    expect(seen.status).toBe(200);
    expect(seen.body.flags.barber_notice).toEqual({ enabled: true, value: 'Test notice from flags test' });
    expect(seen.body.flags.barber_notice.description).toBeUndefined();
    expect((await request(app).get('/api/barber/flags')).status).toBe(401);

    expect((await request(app).patch('/api/admin/tech/flags/no_such_flag').set('Cookie', tech).send({ enabled: true })).status).toBe(404);
    expect((await request(app).patch('/api/admin/tech/flags/barber_notice').set('Cookie', tech).send({})).status).toBe(400);
    expect((await request(app).patch('/api/admin/tech/flags/barber_notice').set('Cookie', tech).send({ value: 'x'.repeat(201) })).status).toBe(400);
    expect((await request(app).patch('/api/admin/tech/flags/Bad-Key').set('Cookie', tech).send({ enabled: true })).status).toBe(400);

    const { count } = await supabase
      .from('admin_audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'tech.flag_update')
      .eq('target_id', 'barber_notice');
    expect(count).toBeGreaterThan(0);
  }, 120_000);
});
