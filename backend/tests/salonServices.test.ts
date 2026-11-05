// backend/tests/salonServices.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const PASSWORD = 'testpass123';

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
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  const cookie = raw.find((c) => c.startsWith('access_token='))?.split(';')[0];
  if (!cookie) throw new Error('login did not return an access_token cookie');

  const as = {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  };
  return { salonId, as };
}

async function add(as: Awaited<ReturnType<typeof makeBarber>>['as'], name: string, durationMinutes: number) {
  return as.post('/api/barber/services').send({ name, durationMinutes });
}

describe('Barber services (Slice 1)', () => {
  it('rejects every services route with no session', async () => {
    expect((await request(app).get('/api/barber/services')).status).toBe(401);
    expect((await request(app).post('/api/barber/services').send({})).status).toBe(401);
  });

  it('creates a service and lists it', async () => {
    const { as } = await makeBarber();
    const created = await add(as, '  Haircut ', 20);
    expect(created.status).toBe(201);
    expect(created.body.service).toMatchObject({ name: 'Haircut', durationMinutes: 20 });

    const list = await as.get('/api/barber/services');
    expect(list.status).toBe(200);
    expect(list.body.services).toHaveLength(1);
    expect(list.body.services[0].id).toBe(created.body.service.id);
  });

  it('a new salon starts with no services', async () => {
    const { as } = await makeBarber();
    const list = await as.get('/api/barber/services');
    expect(list.body.services).toEqual([]);
  });

  it('validates the body', async () => {
    const { as } = await makeBarber();
    const bad = [
      { name: 'Cut', durationMinutes: 0 },
      { name: 'Cut', durationMinutes: 241 },
      { name: 'Cut', durationMinutes: 1.5 },
      { name: 'Cut', durationMinutes: '20' },
      { name: '   ', durationMinutes: 20 },
      { name: 'x'.repeat(61), durationMinutes: 20 },
      { durationMinutes: 20 },
      { name: 'Cut' },
      { name: 'Cut', durationMinutes: 20, salonId: randomUUID() }, // unknown field rejected
    ];
    for (const body of bad) {
      const res = await as.post('/api/barber/services').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await as.get('/api/barber/services')).body.services).toEqual([]);
  });

  it('rejects duplicate names within a salon, ignoring case and spacing', async () => {
    const { as } = await makeBarber();
    expect((await add(as, 'Haircut', 20)).status).toBe(201);
    expect((await add(as, ' haircut ', 25)).status).toBe(409);
  });

  it('allows the same name in different salons', async () => {
    const a = await makeBarber();
    const b = await makeBarber();
    expect((await add(a.as, 'Haircut', 20)).status).toBe(201);
    expect((await add(b.as, 'Haircut', 20)).status).toBe(201);
  });

  it('updates name and duration, and rejects a rename onto an existing name', async () => {
    const { as } = await makeBarber();
    const haircut = (await add(as, 'Haircut', 20)).body.service;
    await add(as, 'Beard', 10);

    const changed = await as.patch(`/api/barber/services/${haircut.id}`).send({ durationMinutes: 30 });
    expect(changed.status).toBe(200);
    expect(changed.body.service).toMatchObject({ name: 'Haircut', durationMinutes: 30 });

    const renamed = await as.patch(`/api/barber/services/${haircut.id}`).send({ name: 'Cut and style' });
    expect(renamed.body.service.name).toBe('Cut and style');

    expect((await as.patch(`/api/barber/services/${haircut.id}`).send({ name: 'beard' })).status).toBe(409);
    expect((await as.patch(`/api/barber/services/${haircut.id}`).send({})).status).toBe(400);
    expect((await as.patch('/api/barber/services/not-a-uuid').send({ name: 'X' })).status).toBe(400);
  });

  it("another salon cannot see, change or delete this salon's services", async () => {
    const a = await makeBarber();
    const b = await makeBarber();
    const svc = (await add(a.as, 'Haircut', 20)).body.service;

    expect((await b.as.get('/api/barber/services')).body.services).toEqual([]);
    expect((await b.as.patch(`/api/barber/services/${svc.id}`).send({ durationMinutes: 99 })).status).toBe(404);
    expect((await b.as.delete(`/api/barber/services/${svc.id}`)).status).toBe(404);

    const still = await a.as.get('/api/barber/services');
    expect(still.body.services).toHaveLength(1);
    expect(still.body.services[0]).toMatchObject({ name: 'Haircut', durationMinutes: 20 });
  });

  it('soft-deletes: hidden from the list, row kept, name reusable, second delete is 404', async () => {
    const { as } = await makeBarber();
    const svc = (await add(as, 'Haircut', 20)).body.service;

    expect((await as.delete(`/api/barber/services/${svc.id}`)).status).toBe(200);
    expect((await as.get('/api/barber/services')).body.services).toEqual([]);

    const { data } = await supabase.from('salon_services').select('deleted_at').eq('id', svc.id).single();
    expect(data?.deleted_at).not.toBeNull();

    expect((await as.delete(`/api/barber/services/${svc.id}`)).status).toBe(404);
    expect((await as.patch(`/api/barber/services/${svc.id}`).send({ name: 'X' })).status).toBe(404);
    expect((await add(as, 'Haircut', 25)).status).toBe(201);
  });

  it('caps a salon at 30 active services', async () => {
    const { salonId, as } = await makeBarber();
    const rows = Array.from({ length: 30 }, (_, i) => ({
      salon_id: salonId,
      name: `Service ${i + 1}`,
      duration_minutes: 10,
    }));
    const { error } = await supabase.from('salon_services').insert(rows);
    expect(error).toBeNull();
    expect((await add(as, 'One too many', 10)).status).toBe(409);
  });
});