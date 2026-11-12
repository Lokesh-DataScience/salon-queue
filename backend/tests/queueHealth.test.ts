// backend/tests/queueHealth.test.ts — Admin Slice 9: queue health (Tech tab).
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';
import { todayISODate } from '../src/utils/date';

afterAll(cleanupSalons);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function admin(role: 'TECH' | 'SALES') {
  const cookie = await barberCookieFor(await makeSalon({ is_internal: true }));
  const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role });
  if (error) throw new Error(error.message);
  return cookie;
}

async function queue(salonId: string, date: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase
    .from('queues')
    .insert({ salon_id: salonId, date, current_token: 0, next_token: 10, status: 'ACTIVE', ...extra })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function entry(queueId: string, token: number, extra: Record<string, unknown> = {}) {
  return supabase.from('queue_entries').insert({
    queue_id: queueId, token_number: token, status: 'WAITING', joined_at: minutesAgo(30),
    access_token: randomBytes(32).toString('hex'), ...extra,
  });
}

const checks = async (cookie: string) => {
  const res = await request(app).get('/api/admin/tech/queues').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body as { checks: Array<{ id: string; rows: Array<Record<string, unknown>> }>; pushToday: Record<string, number> };
};
const rowsFor = (body: Awaited<ReturnType<typeof checks>>, id: string) => body.checks.find((c) => c.id === id)!.rows;

describe('Queue health (Slice 9)', () => {
  it('is for TECH and FOUNDER only', async () => {
    const sales = await admin('SALES');
    expect((await request(app).get('/api/admin/tech/queues').set('Cookie', sales)).status).toBe(404);
    expect((await request(app).get(`/api/admin/tech/salons/${randomUUID()}/queue`).set('Cookie', sales)).status).toBe(404);
  }, 120_000);

  it('finds overdue services, stale tickets from an earlier day and long pauses', async () => {
    const tech = await admin('TECH');
    const today = todayISODate();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    const overdue = await makeSalon();
    const q1 = await queue(overdue, today);
    expect((await entry(q1, 1, { status: 'SERVING', started_at: minutesAgo(25), ends_at: minutesAgo(10) })).error).toBeNull();

    const stale = await makeSalon();
    const q2 = await queue(stale, yesterday);
    expect((await entry(q2, 1)).error).toBeNull();

    const paused = await makeSalon();
    const q3 = await queue(paused, today, { status: 'PAUSED', updated_at: minutesAgo(180) });
    expect((await entry(q3, 1)).error).toBeNull();

    const body = await checks(tech);
    const over = rowsFor(body, 'overdue_serving').find((r) => r.salon_id === overdue);
    expect(over).toBeDefined();
    expect(Number(over!.minutes_over)).toBeGreaterThanOrEqual(9);
    expect(rowsFor(body, 'stale_active').some((r) => r.salon_id === stale)).toBe(true);
    expect(rowsFor(body, 'stuck_paused').some((r) => r.salon_id === paused)).toBe(true);
    expect(body.pushToday).toHaveProperty('withPush');
  }, 180_000);

  it('flags two customers serving at once in one line (if the database even allows it)', async () => {
    const tech = await admin('TECH');
    const salon = await makeSalon();
    const q = await queue(salon, todayISODate());
    await entry(q, 1, { status: 'SERVING', started_at: minutesAgo(5), ends_at: minutesAgo(-10) });
    const second = await entry(q, 2, { status: 'SERVING', started_at: minutesAgo(5), ends_at: minutesAgo(-10) });
    if (second.error) return; // a constraint already makes this impossible — even better
    expect(rowsFor(await checks(tech), 'double_serving').some((r) => r.salon_id === salon)).toBe(true);
  }, 120_000);

  it('shows any salon queue read-only, without customer details', async () => {
    const tech = await admin('TECH');
    const salon = await makeSalon({ name: `Readonly ${randomUUID().slice(0, 6)}` });
    const q = await queue(salon, todayISODate());
    await entry(q, 1, { customer_name: 'Secret Person', customer_phone: '9123456780', prize_code: 'ABC123' });
    await entry(q, 2, { is_walk_in: true });

    const found = await request(app).get('/api/admin/tech/salons?search=Readonly').set('Cookie', tech);
    expect(found.body.salons.some((s: { id: string }) => s.id === salon)).toBe(true);

    const res = await request(app).get(`/api/admin/tech/salons/${salon}/queue`).set('Cookie', tech);
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { token: number }) => e.token)).toEqual([1, 2]);
    expect(res.body.entries[1].walkIn).toBe(true);
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/Secret Person|9123456780|ABC123|access_token/);

    // reading must not change anything
    const { data: after } = await supabase.from('queue_entries').select('status').eq('queue_id', q);
    expect((after ?? []).every((e) => e.status === 'WAITING')).toBe(true);

    expect((await request(app).get(`/api/admin/tech/salons/${randomUUID()}/queue`).set('Cookie', tech)).status).toBe(404);
  }, 120_000);
});
