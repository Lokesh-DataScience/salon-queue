// backend/tests/account.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const OLD = 'oldpass-12345';
const NEW = 'brand-new-pass-99';
const PATH = '/api/barber/account/password';

async function makeStaff() {
  const salonId = await makeSalon();
  const email = `acct-${randomUUID()}@example.test`;
  const { data, error } = await supabase
    .from('salon_staff')
    .insert({
      salon_id: salonId,
      name: 'Test Barber',
      email,
      password_hash: await bcrypt.hash(OLD, 4),
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

const login = (email: string, password = OLD) =>
  request(app).post('/api/auth/barber/login').send({ email, password });
const change = (access: string, body: object) => request(app).post(PATH).set('Cookie', access).send(body);
const refresh = (cookie: string) => request(app).post('/api/auth/barber/refresh').set('Cookie', cookie);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Change password', () => {
  it('requires a login', async () => {
    const res = await request(app).post(PATH).send({ currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(401);
  });

  it('changes the password: the new one signs in, the old one no longer does', async () => {
    const { email } = await makeStaff();
    const access = cookieOf(await login(email), 'access_token')!;

    const res = await change(access, { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);
    expect(cookieOf(res, 'access_token')).toBeTruthy(); // this device stays signed in

    expect((await login(email, NEW)).status).toBe(200);
    expect((await login(email, OLD)).status).toBe(401);
  });

  it('a wrong current password is a 400 (not a logout) and changes nothing', async () => {
    const { email } = await makeStaff();
    const access = cookieOf(await login(email), 'access_token')!;

    const res = await change(access, { currentPassword: 'not-my-password', newPassword: NEW });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/current password is incorrect/i);
    expect((await login(email, OLD)).status).toBe(200);
  });

  it('rejects a short new password, an unchanged one, and unexpected fields', async () => {
    const { email, staffId } = await makeStaff();
    const access = cookieOf(await login(email), 'access_token')!;

    expect((await change(access, { currentPassword: OLD, newPassword: 'short' })).status).toBe(400);
    expect((await change(access, { currentPassword: OLD, newPassword: OLD })).status).toBe(400);
    expect(
      (await change(access, { staffId: randomUUID(), currentPassword: OLD, newPassword: NEW })).status,
    ).toBe(400);
    // Still the old password, for the right account.
    const { data } = await supabase.from('salon_staff').select('password_hash').eq('id', staffId).single();
    expect(await bcrypt.compare(OLD, data!.password_hash)).toBe(true);
  });

  it('signs out other devices but keeps this one', async () => {
    const { email } = await makeStaff();
    const phone = await login(email);
    const laptop = await login(email);
    const phoneAccess = cookieOf(phone, 'access_token')!;
    const laptopRefresh = cookieOf(laptop, 'refresh_token')!;

    // Tokens are stamped in whole seconds, so make sure the change lands in a later second.
    await sleep(1100);
    const res = await change(phoneAccess, { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);

    expect((await refresh(laptopRefresh)).status).toBe(401);
    expect((await refresh(cookieOf(res, 'refresh_token')!)).status).toBe(200);
  });

  it('locks after 5 wrong attempts, even for the right password', async () => {
    const { email } = await makeStaff();
    const access = cookieOf(await login(email), 'access_token')!;

    for (let i = 0; i < 5; i++) {
      expect((await change(access, { currentPassword: 'wrong-wrong-1', newPassword: NEW })).status).toBe(400);
    }
    const locked = await change(access, { currentPassword: OLD, newPassword: NEW });
    expect(locked.status).toBe(429);
    expect((await login(email, OLD)).status).toBe(200); // nothing changed
  });
});