// backend/tests/salonServices.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const PASSWORD = 'testpass123';

function cookieOf(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  return raw.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
}

async function makeBarber() {
  const salonId = await makeSalon();
  const email = `svc-${randomUUID()}@example.test`;
  const { error } = await supabase.from('salon_staff').insert({
    salon_id: salonId,
    name: 'Test Barber',
    email,
    password_hash: await bcrypt.hash(PASSWORD, 4),
    role: 'OWNER',
  });
  if (error) throw new Error(`makeBarber failed: ${error.message}`);

  const res = await request(app).post('/api/auth/barber/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return { salonId, cookie: cookieOf(res, 'access_token')! };
}

const list = (cookie: string) => request(app).get('/api/barber/services').set('Cookie', cookie);
const add = (cookie: string, body: unknown) =>
  request(app).post('/api/barber/services').set('Cookie', cookie).send(body as object);
const remove = (cookie: string, id: string) =>
  request(app).delete(`/api/barber/services/${id}`).set('Cookie', cookie);

async function clearServices(salonId: string) {
  const { error } = await supabase.from('salon_services').delete().eq('salon_id', salonId);
  if (error) throw new Error(`clearServices failed: ${error.message}`);
}

const names = (res: { body: { services: { name: string }[] } }) => res.body.services.map((s) => s.name);

describe('Barber services (step 7)', () => {
  it('rejects every route with no session', async () => {
    expect((await request(app).get('/api/barber/services')).status).toBe(401);
    expect((await request(app).post('/api/barber/services').send({ name: 'scrub' })).status).toBe(401);
    expect((await request(app).delete(`/api/barber/services/${randomUUID()}`)).status).toBe(401);
  });

  it('a new salon starts with the two default services', async () => {
    const { cookie } = await makeBarber();
    const res = await list(cookie);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['hair cutting', 'beard trimming']);
  });

  it('adds a service with a tidied name and lists it last', async () => {
    const { cookie } = await makeBarber();
    const created = await add(cookie, { name: '  head   massage ' });
    expect(created.status).toBe(201);
    expect(created.body.service.name).toBe('head massage');
    expect(created.body.service.id).toEqual(expect.any(String));
    expect(Object.keys(created.body.service).sort()).toEqual(['id', 'name']);

    expect(names(await list(cookie))).toEqual(['hair cutting', 'beard trimming', 'head massage']);
  });

  it('rejects a duplicate name in any letter case', async () => {
    const { cookie } = await makeBarber();
    const res = await add(cookie, { name: 'HAIR   Cutting' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already/i);
    expect(names(await list(cookie))).toHaveLength(2);
  });

  it('rejects bad names, extra fields and a missing name', async () => {
    const { cookie, salonId } = await makeBarber();
    expect((await add(cookie, { name: 'a' })).status).toBe(400);
    expect((await add(cookie, { name: '<script>' })).status).toBe(400);
    expect((await add(cookie, { name: 'x'.repeat(31) })).status).toBe(400);
    expect((await add(cookie, {})).status).toBe(400);
    expect((await add(cookie, { name: 'scrub', salonId })).status).toBe(400);
    expect(names(await list(cookie))).toHaveLength(2);
  });

  it('allows at most 12 services', async () => {
    const { cookie, salonId } = await makeBarber();
    await clearServices(salonId);

    for (let i = 1; i <= 12; i++) {
      expect((await add(cookie, { name: `service ${i}` })).status).toBe(201);
    }
    const over = await add(cookie, { name: 'one too many' });
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/12/);
    expect(names(await list(cookie))).toHaveLength(12);
  });

  it('removes a service: gone from the list, row kept as history, name can be added again', async () => {
    const { cookie, salonId } = await makeBarber();
    const created = await add(cookie, { name: 'scrub' });
    const id = created.body.service.id as string;

    const gone = await remove(cookie, id);
    expect(gone.status).toBe(200);
    expect(gone.body).toEqual({ ok: true });
    expect(names(await list(cookie))).not.toContain('scrub');

    const { data } = await supabase.from('salon_services').select('deleted_at').eq('id', id).single();
    expect(data?.deleted_at).not.toBeNull();

    expect((await remove(cookie, id)).status).toBe(404); // already removed

    const again = await add(cookie, { name: 'scrub' }); // the unique index only covers active rows
    expect(again.status).toBe(201);
    expect(again.body.service.id).not.toBe(id);

    const { count } = await supabase
      .from('salon_services')
      .select('*', { count: 'exact', head: true })
      .eq('salon_id', salonId)
      .eq('name', 'scrub');
    expect(count).toBe(2); // one removed, one active
  });

  it('rejects a malformed service id', async () => {
    const { cookie } = await makeBarber();
    expect((await remove(cookie, 'not-a-uuid')).status).toBe(400);
  });

  it("a barber can neither see nor remove another salon's services", async () => {
    const a = await makeBarber();
    const b = await makeBarber();
    const aSecret = (await add(a.cookie, { name: 'only salon a' })).body.service.id as string;

    expect(names(await list(b.cookie))).not.toContain('only salon a');

    const attempt = await remove(b.cookie, aSecret);
    expect(attempt.status).toBe(404); // same answer as "does not exist": no leak
    expect(names(await list(a.cookie))).toContain('only salon a');
  });

  it('the public list shows ids and names only, with no login', async () => {
    const { salonId } = await makeBarber();
    const res = await request(app).get(`/api/queues/${salonId}/services`);
    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(2);
    for (const s of res.body.services) expect(Object.keys(s).sort()).toEqual(['id', 'name']);
    expect(JSON.stringify(res.body)).not.toMatch(/salon_id|deleted_at|created_at/);
  });

  it('the public list hides removed services', async () => {
    const { salonId, cookie } = await makeBarber();
    const id = (await add(cookie, { name: 'temporary' })).body.service.id as string;
    await remove(cookie, id);

    const res = await request(app).get(`/api/queues/${salonId}/services`);
    expect(res.body.services.map((s: { name: string }) => s.name)).not.toContain('temporary');
  });
});