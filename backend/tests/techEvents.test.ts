// backend/tests/techEvents.test.ts — Admin Slice 8: error and sign-in log.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';
import { createApp } from '../src/app';
import { errorHandler } from '../src/middleware/errorHandler';
import { normalizeRoute } from '../src/services/events.service';

const startedAt = new Date().toISOString();
afterAll(async () => {
  await supabase.from('app_events').delete().gte('created_at', startedAt);
  await cleanupSalons();
});

// Event writes are fire-and-forget: wait until the row shows up.
async function waitForEvent(match: { kind: string; code: string; staff_id?: string }, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    let q = supabase.from('app_events').select('*').eq('kind', match.kind).eq('code', match.code).gte('created_at', startedAt);
    if (match.staff_id) q = q.eq('staff_id', match.staff_id);
    const { data } = await q.limit(1);
    if (data && data.length) return data[0] as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`event not found: ${JSON.stringify(match)}`);
}

function cookiesOf(res: request.Response) {
  return ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
}
const pick = (lines: string[], name: string) =>
  lines.find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`))?.split(';')[0];

async function admin(role: 'TECH' | 'SALES') {
  const cookie = await barberCookieFor(await makeSalon({ is_internal: true }));
  const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role });
  if (error) throw new Error(error.message);
  return cookie;
}

describe('Error and sign-in log (Slice 8)', () => {
  it('route shapes never keep ids or tokens', () => {
    expect(normalizeRoute('/api/admin/founder/salons/3f2a8b1c-1234-4abc-8def-0123456789ab/suspension?x=1'))
      .toBe('/api/admin/founder/salons/:id/suspension');
    expect(normalizeRoute('/api/salons/by-code/a1b2c3d4e5f6')).toBe('/api/salons/by-code/:token');
    expect(normalizeRoute('/api/queue-tickets/push-subscription')).toBe('/api/queue-tickets/push-subscription');
  });

  it('records a 500 by name and code only — never the message', async () => {
    const boom = express();
    boom.get('/api/boom/:id', () => {
      const e = new Error('secret 9876543210 Ravi') as Error & { code?: string };
      e.code = 'XX001';
      throw e;
    });
    boom.use(errorHandler);
    expect((await request(boom).get(`/api/boom/${randomUUID()}`)).status).toBe(500);

    const row = await waitForEvent({ kind: 'error', code: 'Error:XX001' });
    expect(row.route).toBe('GET /api/boom/:id');
    expect(JSON.stringify(row)).not.toMatch(/9876543210|Ravi|secret/);
  }, 60_000);

  it('records why a refresh failed: reused token, missing cookie, failed login', async () => {
    const salonId = await makeSalon({ is_internal: true });
    const email = `ev-${randomUUID()}@example.test`;
    const { data: staff } = await supabase
      .from('salon_staff')
      .insert({ salon_id: salonId, name: 'Ev', email, password_hash: await bcrypt.hash('testpass123', 4), role: 'OWNER' })
      .select('id')
      .single();

    const login = await request(app).post('/api/auth/barber/login').send({ email, password: 'testpass123' });
    const refresh = pick(cookiesOf(login), 'refresh_token')!;
    expect((await request(app).post('/api/auth/barber/refresh').set('Cookie', refresh)).status).toBe(200);
    expect((await request(app).post('/api/auth/barber/refresh').set('Cookie', refresh)).status).toBe(401); // same token again
    await waitForEvent({ kind: 'auth', code: 'REFRESH_REUSED', staff_id: staff!.id });

    expect((await request(app).post('/api/auth/barber/refresh')).status).toBe(401);
    await waitForEvent({ kind: 'auth', code: 'REFRESH_NO_COOKIE' });

    await request(app).post('/api/auth/barber/login').send({ email, password: 'wrong-password' });
    const failed = await waitForEvent({ kind: 'auth', code: 'LOGIN_FAILED' });
    expect(JSON.stringify(failed)).not.toContain(email);
  }, 120_000);

  it('records which rate limit was hit', async () => {
    const limited = createApp({ rateLimits: true });
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await request(limited).post('/api/auth/barber/register').send({})).status;
    expect(last).toBe(429);
    await waitForEvent({ kind: 'rate_limit', code: 'register' });
  }, 60_000);

  it('summary is for TECH (and FOUNDER) only, grouped with counts', async () => {
    const sales = await admin('SALES');
    expect((await request(app).get('/api/admin/tech/events').set('Cookie', sales)).status).toBe(404);

    const tech = await admin('TECH');
    const res = await request(app).get('/api/admin/tech/events?days=1').set('Cookie', tech);
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(1);
    const reused = res.body.auth.find((g: { code: string }) => g.code === 'REFRESH_REUSED');
    expect(reused.count).toBeGreaterThanOrEqual(1);
    expect(reused.accounts).toBeGreaterThanOrEqual(1);
    expect(res.body.rateLimits.some((g: { code: string }) => g.code === 'register')).toBe(true);
    expect(Array.isArray(res.body.recent)).toBe(true);
    expect((await request(app).get('/api/admin/tech/events?days=30').set('Cookie', tech)).status).toBe(400);
  }, 120_000);
});
