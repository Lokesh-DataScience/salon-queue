// backend/tests/team.test.ts
// Slice G against the real database: owner adds barbers, barbers sign in by phone,
// staff are kept out of owner-only routes, and switched-off staff lose access.
// Needs step10_team.sql applied.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const PASSWORD = 'testpass123';
const BARBER_PASSWORD = 'barberpass456';

const cookieOf = (res: { headers: Record<string, unknown> }, name: string) =>
  ([] as string[])
    .concat((res.headers['set-cookie'] as string[] | string | undefined) ?? [])
    .find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`))
    ?.split(';')[0];

const randomPhone = () => '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

async function makeOwner() {
  const salonId = await makeSalon();
  const email = `team-${randomUUID()}@example.test`;
  const { error } = await supabase.from('salon_staff').insert({
    salon_id: salonId,
    name: 'Test Owner',
    email,
    password_hash: await bcrypt.hash(PASSWORD, 4),
    role: 'OWNER',
  });
  if (error) throw new Error(`makeOwner failed: ${error.message}`);
  const res = await request(app).post('/api/auth/barber/login').send({ identifier: email, password: PASSWORD });
  expect(res.status).toBe(200);
  const cookie = cookieOf(res, 'access_token')!;
  return {
    salonId,
    cookie,
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
  };
}

async function addBarber(owner: Awaited<ReturnType<typeof makeOwner>>, phone = randomPhone()) {
  const res = await owner.post('/api/barber/team').send({ name: 'Rahul', phone, password: BARBER_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { member: res.body.member as { id: string; laneId: string }, phone };
}

const loginBarber = (identifier: string, password = BARBER_PASSWORD) =>
  request(app).post('/api/auth/barber/login').send({ identifier, password });

describe('Team (Slice G)', () => {
  it('owner adds a barber; the barber signs in by phone and lands in their own lane', async () => {
    const owner = await makeOwner();
    const { member, phone } = await addBarber(owner);

    const { data: lanes } = await supabase.from('lanes').select('id, is_default').eq('salon_id', owner.salonId);
    expect(lanes).toHaveLength(2); // the owner's default lane + the barber's new lane
    expect(lanes!.some((l) => l.id === member.laneId && !l.is_default)).toBe(true);

    // Typed three different ways, all reach the same account.
    for (const typed of [phone, `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`, `+91${phone}`]) {
      const res = await loginBarber(typed);
      expect(res.status, typed).toBe(200);
      expect(res.body.staff.role).toBe('BARBER');
      expect(res.body.staff.salonId).toBe(owner.salonId);
    }

    const cookie = cookieOf(await loginBarber(phone), 'access_token')!;
    const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.staff).toMatchObject({ role: 'BARBER', salonId: owner.salonId, laneId: member.laneId });
    expect(JSON.stringify(me.body)).not.toContain(phone); // /me never echoes the phone back

    expect((await loginBarber(phone, 'wrong-password')).status).toBe(401);
    expect((await loginBarber(randomPhone())).status).toBe(401);
  }, 60_000);

  it('staff are refused on owner-only routes but keep the queue and /me', async () => {
    const owner = await makeOwner();
    const { phone } = await addBarber(owner);
    const cookie = cookieOf(await loginBarber(phone), 'access_token')!;
    const as = (m: 'get' | 'post' | 'patch', url: string) => (request(app) as any)[m](url).set('Cookie', cookie).send({});

    for (const [m, url] of [
      ['get', '/api/barber/salon'], ['patch', '/api/barber/salon'], ['get', '/api/barber/stats'],
      ['get', '/api/barber/services'], ['get', '/api/barber/offers'], ['post', '/api/barber/offers'],
      ['get', '/api/barber/team'], ['post', '/api/barber/team'],
    ] as const) {
      expect((await as(m, url)).status, `${m} ${url}`).toBe(403);
    }
    expect((await as('get', '/api/barber/queue')).status).toBe(200);
    expect((await as('get', '/api/barber/me')).status).toBe(200);
    expect((await as('post', `/api/barber/queue/${randomUUID()}/redeem-prize`)).status).toBe(404); // staff may reach it (not 403); no such entry
  }, 60_000);

  it('refuses a phone number that is already registered, in this salon or any other', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const { phone } = await addBarber(a);

    const same = await a.post('/api/barber/team').send({ name: 'Dup', phone, password: BARBER_PASSWORD });
    expect(same.status).toBe(409);
    const other = await b.post('/api/barber/team').send({ name: 'Dup', phone, password: BARBER_PASSWORD });
    expect(other.status).toBe(409);
    const { data: lanes } = await supabase.from('lanes').select('id').eq('salon_id', b.salonId);
    expect(lanes).toHaveLength(1); // the failed add left no stray lane behind
  }, 60_000);

  it('switching off cuts off login, refresh and /me, and switching on restores them', async () => {
    const owner = await makeOwner();
    const { member, phone } = await addBarber(owner);

    const session = await loginBarber(phone);
    const access = cookieOf(session, 'access_token')!;
    const refresh = cookieOf(session, 'refresh_token')!;

    expect((await owner.patch(`/api/barber/team/${member.id}`).send({ isActive: false })).status).toBe(200);

    expect((await loginBarber(phone)).status).toBe(403); // right password, account switched off
    expect((await loginBarber(phone, 'wrong-password')).status).toBe(401); // no probing with a wrong one
    expect((await request(app).post('/api/auth/barber/refresh').set('Cookie', refresh)).status).toBe(401);
    expect((await request(app).get('/api/barber/me').set('Cookie', access)).status).toBe(401);

    expect((await owner.patch(`/api/barber/team/${member.id}`).send({ isActive: true })).status).toBe(200);
    expect((await loginBarber(phone)).status).toBe(200);
  }, 90_000);

  it('switching off moves waiting customers to the shortest line and keeps their tokens (Slice J)', async () => {
    const owner = await makeOwner();
    const a = await addBarber(owner);
    const b = await addBarber(owner);
    const { data: ownerLane } = await supabase
      .from('lanes').select('id').eq('salon_id', owner.salonId).eq('is_default', true).single();

    const today = new Date().toISOString().slice(0, 10);
    const { data: q } = await supabase
      .from('queues')
      .insert({ salon_id: owner.salonId, date: today, current_token: 0, next_token: 6, status: 'ACTIVE' })
      .select('id').single();
    const put = async (token: number, laneId: string) => {
      const { data } = await supabase
        .from('queue_entries')
        .insert({ queue_id: q!.id, token_number: token, status: 'WAITING', access_token: randomUUID(), lane_id: laneId })
        .select('id').single();
      return data!.id as string;
    };
    // barber A has two waiting, the owner has three, barber B is empty.
    const a1 = await put(1, a.member.laneId);
    const a2 = await put(2, a.member.laneId);
    await put(3, ownerLane!.id);
    await put(4, ownerLane!.id);
    await put(5, ownerLane!.id);

    const res = await owner.patch(`/api/barber/team/${a.member.id}`).send({ isActive: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved).toBe(2);
    expect(res.body.member).toEqual({ id: a.member.id, isActive: false });

    const { data: rows } = await supabase
      .from('queue_entries').select('id, token_number, status, lane_id').in('id', [a1, a2]).order('token_number');
    expect(rows!.map((r) => r.status)).toEqual(['WAITING', 'WAITING']);
    expect(rows!.map((r) => r.token_number)).toEqual([1, 2]); // tokens never change
    expect(rows!.map((r) => r.lane_id)).toEqual([b.member.laneId, b.member.laneId]); // the empty line
  }, 90_000);

  it('a customer being called or served blocks switching off, until they are done (Slice J)', async () => {
    const owner = await makeOwner();
    const { member } = await addBarber(owner);
    const today = new Date().toISOString().slice(0, 10);
    const { data: q } = await supabase
      .from('queues')
      .insert({ salon_id: owner.salonId, date: today, current_token: 0, next_token: 2, status: 'ACTIVE' })
      .select('id').single();
    const { data: entry } = await supabase
      .from('queue_entries')
      .insert({ queue_id: q!.id, token_number: 1, status: 'CALLED', access_token: randomUUID(), lane_id: member.laneId })
      .select('id').single();

    const blocked = await owner.patch(`/api/barber/team/${member.id}`).send({ isActive: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/being called or served/i);

    await supabase.from('queue_entries').update({ status: 'COMPLETED' }).eq('id', entry!.id);
    expect((await owner.patch(`/api/barber/team/${member.id}`).send({ isActive: false })).status).toBe(200);
  }, 90_000);

  it('the owner can reset a barber password; nobody else can touch the barber', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const { member, phone } = await addBarber(a);

    expect((await b.post(`/api/barber/team/${member.id}/password`).send({ password: 'hijacked-1234' })).status).toBe(404);
    expect((await b.patch(`/api/barber/team/${member.id}`).send({ isActive: false })).status).toBe(404);
    expect((await loginBarber(phone)).status).toBe(200); // untouched

    expect((await a.post(`/api/barber/team/${member.id}/password`).send({ password: 'short' })).status).toBe(400);
    expect((await a.post(`/api/barber/team/${member.id}/password`).send({ password: 'brand-new-pass-1' })).status).toBe(200);
    expect((await loginBarber(phone, BARBER_PASSWORD)).status).toBe(401);
    expect((await loginBarber(phone, 'brand-new-pass-1')).status).toBe(200);
  }, 60_000);

  it('the owner can never be switched off or have their password reset from the team routes', async () => {
    const owner = await makeOwner();
    const { data } = await supabase.from('salon_staff').select('id').eq('salon_id', owner.salonId).eq('role', 'OWNER').single();
    expect((await owner.patch(`/api/barber/team/${data!.id}`).send({ isActive: false })).status).toBe(404);
    expect((await owner.post(`/api/barber/team/${data!.id}/password`).send({ password: 'new-password-1' })).status).toBe(404);
  }, 60_000);

  it('the team list shows only this salon, owner first, and never a password hash', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await addBarber(a);
    await addBarber(b);

    const res = await a.get('/api/barber/team');
    expect(res.status).toBe(200);
    expect(res.body.team).toHaveLength(2);
    expect(res.body.team[0].role).toBe('OWNER');
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
  }, 60_000);
});
