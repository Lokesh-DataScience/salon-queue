// backend/tests/shopHelpers.ts — shared setup for the shop tests (Commerce Phase 1).
//
// Shop tables keep staff references with ON DELETE RESTRICT (D19), so a throwaway founder that writes
// stock history could never be cleaned up. Shop WRITES therefore use ONE permanent test founder that
// already exists in the TESTS project (C0-D1): set in backend/.env.test
//   TEST_FOUNDER_EMAIL=admin@example.com
//   TEST_FOUNDER_PASSWORD=<that account's password in the tests project>
// Cofounder / Sales / Tech accounts are throwaway: they only read, or are refused before any write.
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon } from './helpers';
import { supabase } from '../src/config/supabase';
import { env } from '../src/config/env';

export const ORIGIN = new URL(env.FRONTEND_URL).origin;

function accessCookie(res: request.Response): string {
  const lines = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  const access = lines.find((c) => c.startsWith('access_token=') && !c.startsWith('access_token=;'));
  if (!access) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return access.split(';')[0];
}

export async function founderSession() {
  const email = process.env.TEST_FOUNDER_EMAIL;
  const password = process.env.TEST_FOUNDER_PASSWORD;
  if (!email || !password) {
    throw new Error('Set TEST_FOUNDER_EMAIL and TEST_FOUNDER_PASSWORD in backend/.env.test (the permanent test founder).');
  }
  const res = await request(app).post('/api/auth/barber/login').send({ email, password });
  const cookie = accessCookie(res);
  const { data: staff, error } = await supabase.from('salon_staff').select('id, salon_id').eq('email', email).single();
  if (error) throw new Error(error.message);
  const { data: role } = await supabase.from('staff_admin_roles').select('role').eq('staff_id', staff.id).maybeSingle();
  if (role?.role !== 'FOUNDER') throw new Error(`${email} must have the FOUNDER role in the tests project.`);
  const csrf = await request(app)
    .post('/api/admin/shop/session')
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .send({});
  if (csrf.status !== 200) throw new Error(`shop session failed: ${csrf.status}`);
  return { cookie, staffId: staff.id as string, salonId: staff.salon_id as string, csrf: csrf.body.csrfToken as string };
}

// A throwaway admin (or plain barber when role is null) in a throwaway internal salon.
export async function throwawayAdmin(role: 'COFOUNDER' | 'SALES' | 'TECH' | null) {
  const salonId = await makeSalon({ is_internal: true });
  const email = `shop-${randomUUID()}@example.test`;
  const password = 'testpass123';
  const { data, error } = await supabase
    .from('salon_staff')
    .insert({ salon_id: salonId, name: 'Shop Test', email, password_hash: await bcrypt.hash(password, 4), role: 'OWNER' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  if (role) {
    const { error: e2 } = await supabase.from('staff_admin_roles').upsert({ staff_id: data.id, role });
    if (e2) throw new Error(e2.message);
  }
  const res = await request(app).post('/api/auth/barber/login').send({ email, password });
  return { cookie: accessCookie(res), staffId: data.id as string, salonId };
}

// Request builder for /api/admin/shop. Writes send Origin + CSRF unless told not to.
export function shopApi(s: { cookie: string; csrf?: string }) {
  const base = (r: request.Test) => r.set('Cookie', s.cookie);
  const write = (r: request.Test, body: object) =>
    base(r)
      .set('Origin', ORIGIN)
      .set('x-admin-csrf', s.csrf ?? '')
      .send(body);
  return {
    get: (p: string) => base(request(app).get(`/api/admin/shop${p}`)),
    post: (p: string, b: object = {}) => write(request(app).post(`/api/admin/shop${p}`), b),
    patch: (p: string, b: object = {}) => write(request(app).patch(`/api/admin/shop${p}`), b),
    del: (p: string, b: object = {}) => write(request(app).delete(`/api/admin/shop${p}`), b),
  };
}

export const testSku = () => `TEST-${randomUUID().slice(0, 8)}`;

export function productBody(overrides: Record<string, unknown> = {}) {
  return {
    sku: testSku(),
    name: 'TEST Beard Oil 50ml (safe to ignore)',
    brand: 'TestBrand',
    mrpPaise: 25000,
    sellingPricePaise: 22000,
    wholesaleCostPaise: 18000,
    initialStock: 10,
    ...overrides,
  };
}

// Test products can't be hard-deleted (their stock history is kept), so they are soft-deleted at the end.
export async function softDeleteProducts(founder: { cookie: string; csrf: string }, ids: string[]) {
  for (const id of ids) await shopApi(founder).del(`/products/${id}`);
}

// 1×1 transparent PNG.
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
