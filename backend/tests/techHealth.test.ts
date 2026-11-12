// backend/tests/techHealth.test.ts — Admin Slice 7: Tech health panel.
// Run this file on its own. It writes to the job_heartbeats table of the TESTS project only.
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';
import { recordFailure, recordSuccess, resetHeartbeatThrottle } from '../src/services/heartbeat.service';
import { statusOf } from '../src/services/techHealth.service';

afterAll(async () => {
  await supabase.from('job_heartbeats').delete().in('name', ['sweeper', 'pinger']);
  await cleanupSalons();
});
beforeEach(resetHeartbeatThrottle);

async function admin(role: 'TECH' | 'SALES' | 'FOUNDER') {
  const cookie = await barberCookieFor(await makeSalon({ is_internal: true }));
  const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role });
  if (error) throw new Error(error.message);
  return cookie;
}

const health = async (cookie: string) => {
  const res = await request(app).get('/api/admin/tech/health').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body;
};
const job = (body: { jobs: Array<{ name: string }> }, name: string) =>
  body.jobs.find((j) => j.name === name) as Record<string, unknown>;

describe('Tech health (Slice 7)', () => {
  it('is for TECH and FOUNDER only', async () => {
    const sales = await admin('SALES');
    expect((await request(app).get('/api/admin/tech/health').set('Cookie', sales)).status).toBe(404);
    const founder = await admin('FOUNDER');
    expect((await request(app).get('/api/admin/tech/health').set('Cookie', founder)).status).toBe(200);
  }, 120_000);

  it('reports the database, server, build and all four jobs', async () => {
    const body = await health(await admin('TECH'));
    expect(body.database.status).toMatch(/ok|late/);
    expect(typeof body.database.responseMs).toBe('number');
    expect(body.server.nodeVersion).toMatch(/^v\d+/);
    expect(body.server.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.jobs.map((j: { name: string }) => j.name)).toEqual(['sweeper', 'cleanup', 'news', 'pinger']);
    expect(body).toHaveProperty('build.commit');
  }, 120_000);

  it('shows a failure with its code, then recovery straight away', async () => {
    const tech = await admin('TECH');
    await recordFailure('sweeper', 'ADVANCE_FAILED');
    expect(job(await health(tech), 'sweeper')).toMatchObject({ status: 'failing', lastFailureCode: 'ADVANCE_FAILED' });

    await recordSuccess('sweeper', { changes: 2 }); // right after a failure: not throttled
    expect(job(await health(tech), 'sweeper')).toMatchObject({ status: 'ok', detail: { changes: 2 } });
  }, 120_000);

  it('counts only the uptime pinger, not other visitors to /api/health', async () => {
    const tech = await admin('TECH');
    await supabase.from('job_heartbeats').delete().eq('name', 'pinger');

    await request(app).get('/api/health').set('User-Agent', 'Mozilla/5.0 (a person)');
    await new Promise((r) => setTimeout(r, 1500)); // the heartbeat write is fire-and-forget
    expect(job(await health(tech), 'pinger')).toMatchObject({ status: 'unknown' });

    await request(app).get('/api/health').set('User-Agent', 'Mozilla/5.0 (compatible; cron-job.org/1.2)');
    await new Promise((r) => setTimeout(r, 1500));
    expect(job(await health(tech), 'pinger')).toMatchObject({ status: 'ok' });
  }, 120_000);

  it('status rules: unknown, ok, late, failing', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    const at = (msAgo: number) => new Date(now - msAgo).toISOString();
    const row = (ok: string | null, bad: string | null) => ({
      name: 'x', last_success_at: ok, last_failure_at: bad, last_failure_code: null, last_detail: {},
    });
    expect(statusOf(undefined, 60_000, now)).toBe('unknown');
    expect(statusOf(row(at(30_000), null), 60_000, now)).toBe('ok');
    expect(statusOf(row(at(90_000), null), 60_000, now)).toBe('late');
    expect(statusOf(row(at(90_000), at(10_000)), 60_000, now)).toBe('failing');
    expect(statusOf(row(at(10_000), at(90_000)), 60_000, now)).toBe('ok');
  });
});
