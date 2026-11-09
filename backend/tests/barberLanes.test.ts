// backend/tests/barberLanes.test.ts
// Slice I against the real database: each barber works only their own line, the owner can look at
// any line, walk-ins and breaks are per line, and staff can change their own password.
// Needs step9 to step12 applied.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const OWNER_PASSWORD = 'testpass123';
const BARBER_PASSWORD = 'barberpass456';

const cookieOf = (res: { headers: Record<string, unknown> }, name = 'access_token') =>
  ([] as string[])
    .concat((res.headers['set-cookie'] as string[] | string | undefined) ?? [])
    .find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`))
    ?.split(';')[0];

const randomPhone = () => '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

async function makeTeam() {
  const salonId = await makeSalon({ average_service_minutes: 10 });
  const email = `lanes-${randomUUID()}@example.test`;
  const { error } = await supabase.from('salon_staff').insert({
    salon_id: salonId, name: 'Test Owner', email,
    password_hash: await bcrypt.hash(OWNER_PASSWORD, 4), role: 'OWNER',
  });
  if (error) throw new Error(error.message);
  const ownerLogin = await request(app).post('/api/auth/barber/login').send({ identifier: email, password: OWNER_PASSWORD });
  expect(ownerLogin.status).toBe(200);
  const ownerCookie = cookieOf(ownerLogin)!;

  const phone = randomPhone();
  const added = await request(app).post('/api/barber/team').set('Cookie', ownerCookie)
    .send({ name: 'Rahul', phone, password: BARBER_PASSWORD });
  expect(added.status, JSON.stringify(added.body)).toBe(201);
  const barberLogin = await request(app).post('/api/auth/barber/login').send({ identifier: phone, password: BARBER_PASSWORD });
  expect(barberLogin.status).toBe(200);

  const { data: main } = await supabase.from('lanes').select('id').eq('salon_id', salonId).eq('is_default', true).single();
  return {
    salonId, phone, email,
    mainId: main!.id as string,
    rahulId: added.body.member.laneId as string,
    rahulStaffId: added.body.member.id as string,
    owner: ownerCookie,
    barber: cookieOf(barberLogin)!,
  };
}
type Team = Awaited<ReturnType<typeof makeTeam>>;

const get = (cookie: string, url: string) => request(app).get(url).set('Cookie', cookie);
const post = (cookie: string, url: string, body: Record<string, unknown> = {}) =>
  request(app).post(url).set('Cookie', cookie).send(body);
const join = (salonId: string, laneId?: string) =>
  request(app).post(`/api/queues/${salonId}/join`).send(laneId ? { laneId } : {});
async function joinOk(salonId: string, laneId?: string) {
  const res = await join(salonId, laneId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.ticket as { ticketId: string; tokenNumber: number };
}
const laneOfEntry = async (id: string) =>
  (await supabase.from('queue_entries').select('lane_id').eq('id', id).single()).data!.lane_id as string;

async function twoLinesWithCustomers(t: Team) {
  const m1 = await joinOk(t.salonId, t.mainId);    // serving in the owner's line
  const r1 = await joinOk(t.salonId, t.rahulId);   // serving in Rahul's line
  const r2 = await joinOk(t.salonId, t.rahulId);   // waiting in Rahul's line
  const m2 = await joinOk(t.salonId, t.mainId);    // waiting in the owner's line
  return { m1, r1, r2, m2 };
}

describe("Each barber works their own line (Slice I)", () => {
  it("staff see only their own line; the owner sees their own by default, and any line by asking", async () => {
    const t = await makeTeam();
    const c = await twoLinesWithCustomers(t);

    const staff = (await get(t.barber, '/api/barber/queue')).body;
    expect(staff.lane.id).toBe(t.rahulId);
    expect(staff.serving.token_number).toBe(c.r1.tokenNumber);
    expect(staff.waiting.map((e: { token_number: number }) => e.token_number)).toEqual([c.r2.tokenNumber]);
    expect(staff.currentToken).toBe(c.r1.tokenNumber);
    expect(staff.lanes).toBeNull(); // staff never get the owner's switcher

    // naming the owner's line changes nothing for staff
    const sneaky = (await get(t.barber, `/api/barber/queue?laneId=${t.mainId}`)).body;
    expect(sneaky.lane.id).toBe(t.rahulId);
    expect(sneaky.serving.token_number).toBe(c.r1.tokenNumber);

    const owner = (await get(t.owner, '/api/barber/queue')).body;
    expect(owner.lane.id).toBe(t.mainId);
    expect(owner.serving.token_number).toBe(c.m1.tokenNumber);
    expect(owner.lanes).toHaveLength(2);
    expect(owner.lanes.find((l: { isMine: boolean }) => l.isMine).id).toBe(t.mainId);
    expect(owner.lanes.find((l: { id: string }) => l.id === t.rahulId).waitingCount).toBe(1);

    const viewRahul = (await get(t.owner, `/api/barber/queue?laneId=${t.rahulId}`)).body;
    expect(viewRahul.lane.id).toBe(t.rahulId);
    expect(viewRahul.serving.token_number).toBe(c.r1.tokenNumber);

    expect((await get(t.owner, `/api/barber/queue?laneId=${randomUUID()}`)).status).toBe(404);
    expect((await get(t.owner, '/api/barber/queue?laneId=not-a-uuid')).status).toBe(400);
    const other = await makeTeam();
    expect((await get(t.owner, `/api/barber/queue?laneId=${other.rahulId}`)).status).toBe(404); // another salon's line
  }, 180_000);

  it("staff cannot act on another barber's customers; the owner can act on any line", async () => {
    const t = await makeTeam();
    const c = await twoLinesWithCustomers(t);
    const ownersServing = (await get(t.owner, '/api/barber/queue')).body.serving.id as string;
    const ownersWaiting = (await get(t.owner, '/api/barber/queue')).body.waiting[0].id as string;

    for (const [action, id] of [['skip', ownersServing], ['complete', ownersServing], ['start', ownersServing],
      ['prioritize', ownersWaiting], ['extend', ownersServing]] as const) {
      const res = await post(t.barber, `/api/barber/queue/${id}/${action}`, action === 'extend' ? { minutes: 5 } : {});
      expect(res.status, action).toBe(404);
    }
    const { data: still } = await supabase.from('queue_entries').select('status').eq('id', ownersServing).single();
    expect(still!.status).toBe('SERVING'); // untouched

    // the owner may complete a customer in Rahul's line
    const rahulServing = (await get(t.owner, `/api/barber/queue?laneId=${t.rahulId}`)).body.serving.id as string;
    expect((await post(t.owner, `/api/barber/queue/${rahulServing}/complete`)).status).toBe(200);
    // ...and Rahul's next customer starts automatically in Rahul's line only
    const after = (await get(t.barber, '/api/barber/queue')).body;
    expect(after.serving.token_number).toBe(c.r2.tokenNumber);
    expect((await get(t.owner, '/api/barber/queue')).body.serving.token_number).toBe(c.m1.tokenNumber);
  }, 180_000);

  it('walk-ins join the right line, whatever a barber puts in the request', async () => {
    const t = await makeTeam();

    const byBarber = await post(t.barber, `/api/barber/queue/walk-in?laneId=${t.mainId}`);
    expect(byBarber.status, JSON.stringify(byBarber.body)).toBe(201);
    expect(byBarber.body.entry.laneName).toBe('Rahul');
    expect(await laneOfEntry(byBarber.body.entry.id)).toBe(t.rahulId); // the barber's own line, not the one named

    const byOwner = await post(t.owner, '/api/barber/queue/walk-in');
    expect(await laneOfEntry(byOwner.body.entry.id)).toBe(t.mainId);

    const ownerForRahul = await post(t.owner, `/api/barber/queue/walk-in?laneId=${t.rahulId}`);
    expect(ownerForRahul.status).toBe(201);
    expect(await laneOfEntry(ownerForRahul.body.entry.id)).toBe(t.rahulId);

    const tokens = [byBarber, byOwner, ownerForRahul].map((r) => r.body.entry.tokenNumber).sort((a, b) => a - b);
    expect(tokens).toEqual([1, 2, 3]); // still one token sequence for the salon
  }, 180_000);

  it("a barber's break closes only their line", async () => {
    const t = await makeTeam();
    expect((await post(t.barber, '/api/barber/queue/pause')).status).toBe(200);

    const lanes = (await request(app).get(`/api/salons/${t.salonId}/lanes`)).body.lanes;
    expect(lanes.find((l: { id: string }) => l.id === t.rahulId).isPaused).toBe(true);
    expect(lanes.find((l: { id: string }) => l.id === t.mainId).isPaused).toBe(false);

    const refused = await join(t.salonId, t.rahulId);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/on a break/);
    expect((await post(t.barber, '/api/barber/queue/walk-in')).status).toBe(409);

    const any = await joinOk(t.salonId); // "Any barber" never picks the barber on a break
    expect(await laneOfEntry(any.ticketId)).toBe(t.mainId);
    expect((await post(t.owner, '/api/barber/queue/walk-in')).status).toBe(201); // the owner keeps working

    expect((await get(t.barber, '/api/barber/queue')).body.queueStatus).toBe('PAUSED');
    expect((await get(t.owner, '/api/barber/queue')).body.queueStatus).toBe('ACTIVE');
    const { data: queue } = await supabase.from('queues').select('status').eq('salon_id', t.salonId).single();
    expect(queue!.status).toBe('ACTIVE'); // the salon itself was never paused

    expect((await post(t.barber, '/api/barber/queue/resume')).status).toBe(200);
    const back = await joinOk(t.salonId, t.rahulId);
    expect(await laneOfEntry(back.ticketId)).toBe(t.rahulId);
  }, 180_000);

  it('a one-barber salon is unchanged: its pause button still pauses the whole queue', async () => {
    const salonId = await makeSalon();
    const email = `solo-${randomUUID()}@example.test`;
    await supabase.from('salon_staff').insert({
      salon_id: salonId, name: 'Solo', email, password_hash: await bcrypt.hash(OWNER_PASSWORD, 4), role: 'OWNER',
    });
    const login = await request(app).post('/api/auth/barber/login').send({ identifier: email, password: OWNER_PASSWORD });
    const cookie = cookieOf(login)!;

    const snap = (await get(cookie, '/api/barber/queue')).body;
    expect(snap.lane).toBeNull();
    expect(snap.lanes).toBeNull();

    expect((await post(cookie, '/api/barber/queue/pause')).status).toBe(200);
    const { data: queue } = await supabase.from('queues').select('status').eq('salon_id', salonId).single();
    expect(queue!.status).toBe('PAUSED');
    expect((await join(salonId)).status).toBe(409);
    expect((await post(cookie, '/api/barber/queue/resume')).status).toBe(200);
    await joinOk(salonId);
  }, 120_000);

  it('a barber who is switched off loses access to the queue at once, even with a valid token', async () => {
    const t = await makeTeam();
    expect((await get(t.barber, '/api/barber/queue')).status).toBe(200);
    const off = await request(app).patch(`/api/barber/team/${t.rahulStaffId}`).set('Cookie', t.owner).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await get(t.barber, '/api/barber/queue')).status).toBe(401);
    expect((await post(t.barber, '/api/barber/queue/walk-in')).status).toBe(401);
  }, 120_000);
});

describe('Staff change their own password (Slice I)', () => {
  it('needs the current password, a good new one, and then the old one stops working', async () => {
    const t = await makeTeam();
    const change = (body: Record<string, unknown>) => post(t.barber, '/api/barber/me/password', body);

    const wrong = await change({ currentPassword: 'not-my-password', newPassword: 'brand-new-pass-1' });
    expect(wrong.status).toBe(400); // 400, not 401: a 401 would log them out of the app
    expect(wrong.body.message).toBe('Your current password is not correct.');
    expect((await change({ currentPassword: BARBER_PASSWORD, newPassword: 'short' })).status).toBe(400);
    expect((await change({ currentPassword: BARBER_PASSWORD, newPassword: BARBER_PASSWORD })).status).toBe(400);
    expect((await change({ currentPassword: BARBER_PASSWORD, newPassword: 'brand-new-pass-1', role: 'OWNER' })).status).toBe(400);
    expect((await request(app).post('/api/barber/me/password').send({})).status).toBe(401);

    expect((await change({ currentPassword: BARBER_PASSWORD, newPassword: 'brand-new-pass-1' })).status).toBe(200);
    const login = (password: string) => request(app).post('/api/auth/barber/login').send({ identifier: t.phone, password });
    expect((await login(BARBER_PASSWORD)).status).toBe(401);
    expect((await login('brand-new-pass-1')).status).toBe(200);
  }, 120_000);
});
