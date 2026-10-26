import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from './helpers';
import { supabase } from '../src/config/supabase';

const created: string[] = [];
afterAll(async () => {
  if (created.length) await supabase.from('salons').delete().in('id', created); // staff cascade
});

const body = (over: Record<string, unknown> = {}) => ({
  salonName: 'Register Test Salon',
  phone: '98765 43210',
  address: '12 Main Road, Korba',
  latitude: 22.35,
  longitude: 82.68,
  ownerName: 'Test Owner',
  email: `reg-${randomUUID()}@example.test`,
  password: 'a-long-enough-pass',
  ...over,
});

describe('POST /api/auth/barber/register', () => {
  it('creates the salon + owner, signs them in, and the QR code is readable', async () => {
    const b = body();
    const res = await request(app).post('/api/auth/barber/register').send(b);
    expect(res.status).toBe(201);
    created.push(res.body.staff.salonId);
    expect(res.body.staff.role).toBe('OWNER');
    expect(JSON.stringify(res.body)).not.toContain(b.password);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);

    const salon = await request(app).get('/api/barber/salon').set('Cookie', cookies);
    expect(salon.status).toBe(200);
    expect(salon.body.salon.qrCode).toMatch(/^[a-f0-9]{12}$/);

    const login = await request(app).post('/api/auth/barber/login').send({ email: b.email, password: b.password });
    expect(login.status).toBe(200);
  });

  it('rejects a duplicate email (any capitalisation) and leaves no extra salon behind', async () => {
    const b = body();
    const first = await request(app).post('/api/auth/barber/register').send(b);
    created.push(first.body.staff.salonId);
    const again = await request(app).post('/api/auth/barber/register').send({ ...b, email: b.email.toUpperCase() });
    expect(again.status).toBe(409);
    const { count } = await supabase.from('salons').select('*', { count: 'exact', head: true }).eq('name', b.salonName).eq('address', b.address);
    expect(count).toBe(created.length); // only the salons we deliberately made
  });

  it('rejects a short password, a bad phone, and closing before opening', async () => {
    for (const bad of [{ password: 'short' }, { phone: 'abc' }, { openingTime: '21:00', closingTime: '09:00' }]) {
      const res = await request(app).post('/api/auth/barber/register').send(body(bad));
      expect(res.status).toBe(400);
    }
  });
});