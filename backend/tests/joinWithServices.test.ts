// backend/tests/joinWithServices.test.ts
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

// A salon plus a barber session for it. The salon already has the two default services.
async function makeSalonWithBarber() {
  const salonId = await makeSalon();
  const email = `join-${randomUUID()}@example.test`;
  const { error } = await supabase.from('salon_staff').insert({
    salon_id: salonId,
    name: 'Test Barber',
    email,
    password_hash: await bcrypt.hash(PASSWORD, 4),
    role: 'OWNER',
  });
  if (error) throw new Error(`staff insert failed: ${error.message}`);
  const res = await request(app).post('/api/auth/barber/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);

  const services = (await request(app).get(`/api/queues/${salonId}/services`)).body.services as {
    id: string;
    name: string;
  }[];
  return { salonId, cookie: cookieOf(res, 'access_token')!, services };
}

const join = (salonId: string, body: object) => request(app).post(`/api/queues/${salonId}/join`).send(body);

async function chosen(ticketId: string) {
  const { data, error } = await supabase
    .from('queue_entry_services')
    .select('service_id, service_name')
    .eq('entry_id', ticketId);
  if (error) throw new Error(error.message);
  return (data ?? []).sort((x, y) => x.service_name.localeCompare(y.service_name));
}

describe('Join with chosen services (step 8)', () => {
  it('stores the chosen services with their names', async () => {
    const { salonId, services } = await makeSalonWithBarber();
    const res = await join(salonId, { serviceIds: services.map((s) => s.id) });
    expect(res.status).toBe(201);

    const rows = await chosen(res.body.ticket.ticketId);
    expect(rows.map((r) => r.service_name)).toEqual(['beard trimming', 'hair cutting']);
    expect(rows.map((r) => r.service_id).sort()).toEqual(services.map((s) => s.id).sort());
  });

  it('joining with no services still works and stores nothing', async () => {
    const { salonId } = await makeSalonWithBarber();
    const none = await join(salonId, {});
    const empty = await join(salonId, { serviceIds: [] });
    expect(none.status).toBe(201);
    expect(empty.status).toBe(201);
    expect(await chosen(none.body.ticket.ticketId)).toHaveLength(0);
    expect(await chosen(empty.body.ticket.ticketId)).toHaveLength(0);
  });

  it("ignores a service id that belongs to another salon", async () => {
    const mine = await makeSalonWithBarber();
    const other = await makeSalonWithBarber();

    const res = await join(mine.salonId, { serviceIds: [other.services[0].id] });
    expect(res.status).toBe(201);
    expect(await chosen(res.body.ticket.ticketId)).toHaveLength(0);

    // A mix keeps only this salon's own service.
    const mixed = await join(mine.salonId, { serviceIds: [mine.services[0].id, other.services[1].id] });
    const rows = await chosen(mixed.body.ticket.ticketId);
    expect(rows.map((r) => r.service_id)).toEqual([mine.services[0].id]);
  });

  it('ignores an id that does not exist and a service the barber already removed', async () => {
    const { salonId, cookie, services } = await makeSalonWithBarber();
    await request(app).delete(`/api/barber/services/${services[0].id}`).set('Cookie', cookie);

    const res = await join(salonId, { serviceIds: [services[0].id, randomUUID(), services[1].id] });
    expect(res.status).toBe(201);
    const rows = await chosen(res.body.ticket.ticketId);
    expect(rows.map((r) => r.service_id)).toEqual([services[1].id]);
  });

  it('the same id sent twice is stored once', async () => {
    const { salonId, services } = await makeSalonWithBarber();
    const res = await join(salonId, { serviceIds: [services[0].id, services[0].id] });
    expect(res.status).toBe(201);
    expect(await chosen(res.body.ticket.ticketId)).toHaveLength(1);
  });

  it('removing a service later does not change what an old ticket shows', async () => {
    const { salonId, cookie, services } = await makeSalonWithBarber();
    const res = await join(salonId, { serviceIds: [services[0].id] });

    await request(app).delete(`/api/barber/services/${services[0].id}`).set('Cookie', cookie);

    const rows = await chosen(res.body.ticket.ticketId);
    expect(rows).toHaveLength(1);
    expect(rows[0].service_name).toBe(services[0].name);
  });

  it('a repeated join key returns the same ticket and keeps only the first choice', async () => {
    const { salonId, services } = await makeSalonWithBarber();
    const clientKey = randomUUID().replace(/-/g, '') + 'ab'; // 34 chars, letters and digits

    const first = await join(salonId, { clientKey, serviceIds: [services[0].id] });
    const second = await join(salonId, { clientKey, serviceIds: [services[1].id] });

    expect(first.status).toBe(201);
    expect(second.body.ticket.ticketId).toBe(first.body.ticket.ticketId);
    expect(second.body.ticket.tokenNumber).toBe(first.body.ticket.tokenNumber);
    const rows = await chosen(first.body.ticket.ticketId);
    expect(rows.map((r) => r.service_id)).toEqual([services[0].id]);
  });

  it('rejects malformed service ids and more than 12 ids', async () => {
    const { salonId } = await makeSalonWithBarber();
    expect((await join(salonId, { serviceIds: ['nope'] })).status).toBe(400);
    expect((await join(salonId, { serviceIds: 'abc' })).status).toBe(400);
    expect((await join(salonId, { serviceIds: Array.from({ length: 13 }, () => randomUUID()) })).status).toBe(400);
  });

  it('a failed join (paused queue) stores no services', async () => {
    const { salonId, cookie, services } = await makeSalonWithBarber();
    expect((await request(app).post('/api/barber/queue/pause').set('Cookie', cookie)).status).toBe(200);

    const res = await join(salonId, { serviceIds: [services[0].id] });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/paused/i);

    const { count } = await supabase
      .from('queue_entry_services')
      .select('*', { count: 'exact', head: true })
      .eq('service_id', services[0].id);
    expect(count).toBe(0);
  });

  it('the ticket response does not leak the chosen services or other salons\' data', async () => {
    const { salonId, services } = await makeSalonWithBarber();
    const res = await join(salonId, { serviceIds: [services[0].id] });
    expect(JSON.stringify(res.body)).not.toMatch(/service_name|salon_services/);
  });
});