import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const PASSWORD = 'testpass123';

async function makeStaff() {
  const salonId = await makeSalon();
  const email = `auth-${randomUUID()}@example.test`;
  const { data, error } = await supabase
    .from('salon_staff')
    .insert({
      salon_id: salonId,
      name: 'Test Barber',
      email,
      password_hash: await bcrypt.hash(PASSWORD, 4),
      role: 'OWNER',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`makeStaff failed: ${error?.message}`);
  return { email, staffId: data.id as string };
}

function cookieOf(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  return raw.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
}
function setCookieLine(res: { headers: Record<string, unknown> }, name: string): string {
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  return raw.find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`)) ?? '';
}

const login = (email: string) => request(app).post('/api/auth/barber/login').send({ email, password: PASSWORD });
const refresh = (cookie: string) => request(app).post('/api/auth/barber/refresh').set('Cookie', cookie);

describe('Barber sessions (Milestone 6b)', () => {
  it('login sets an HTTP-only access cookie and a path-scoped refresh cookie', async () => {
    const { email } = await makeStaff();
    const res = await login(email);
    expect(res.status).toBe(200);
    const refreshLine = setCookieLine(res, 'refresh_token');
    expect(refreshLine).toMatch(/HttpOnly/i);
    expect(refreshLine).toMatch(/Path=\/api\/auth\/barber/);
    expect(setCookieLine(res, 'access_token')).toMatch(/HttpOnly/i);
  });

  it('rotates: each refresh token works once, replays are rejected', async () => {
    const { email } = await makeStaff();
    const r1 = cookieOf(await login(email), 'refresh_token')!;

    const first = await refresh(r1);
    expect(first.status).toBe(200);
    const r2 = cookieOf(first, 'refresh_token')!;
    expect(r2).not.toBe(r1);

    expect((await refresh(r1)).status).toBe(401); // replay of the rotated token
    expect((await refresh(r2)).status).toBe(200); // the new one still works
  });

  it('two simultaneous refreshes with the same token: exactly one wins', async () => {
    const { email } = await makeStaff();
    const r1 = cookieOf(await login(email), 'refresh_token')!;
    const results = await Promise.all([refresh(r1), refresh(r1)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('logout revokes the refresh token', async () => {
    const { email } = await makeStaff();
    const r1 = cookieOf(await login(email), 'refresh_token')!;
    const out = await request(app).post('/api/auth/barber/logout').set('Cookie', r1);
    expect(out.status).toBe(200);
    expect((await refresh(r1)).status).toBe(401);
  });

  it('refuses to refresh for a deleted staff account', async () => {
    const { email, staffId } = await makeStaff();
    const r1 = cookieOf(await login(email), 'refresh_token')!;
    await supabase.from('salon_staff').delete().eq('id', staffId);
    expect((await refresh(r1)).status).toBe(401);
  });

  it('rejects barber routes with no session', async () => {
    expect((await request(app).get('/api/barber/queue')).status).toBe(401);
  });
});