// backend/tests/queuePublic.test.ts — Customer app, Slice 1: GET /api/salons/:salonId/queue-public.
// Needs step14_customer_app.sql applied to the tests project.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, barberCookieFor, joinViaApi, customerDetails } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const KEYS = [
  'address',
  'allowAppJoin',
  'closingTime',
  'estimatedWaitMinutes',
  'isOpen',
  'isPaused',
  'lanes',
  'location',
  'name',
  'nowServingToken',
  'openingTime',
  'phone',
  'rating',
  'salonId',
  'waitingCount',
];

const view = (salonId: string) => request(app).get(`/api/salons/${salonId}/queue-public`);

// A one-hour window that cannot contain "now" (India time). Same helper as hours.test.ts.
function windowExcludingNow() {
  const ist = new Date(Date.now() + 330 * 60_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return mins + 180 < 1440
    ? { opening_time: fmt(mins + 120), closing_time: fmt(mins + 180) }
    : { opening_time: fmt(mins - 180), closing_time: fmt(mins - 120) };
}

describe('Public queue view for the customer app', () => {
  it('an empty salon: open, joinable, nobody waiting', async () => {
    const salonId = await makeSalon({ name: 'Queue View Salon' });
    const res = await view(salonId);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(Object.keys(res.body.salon).sort()).toEqual(KEYS);
    expect(res.body.salon).toMatchObject({
      salonId, name: 'Queue View Salon', isOpen: true, isPaused: false, allowAppJoin: true,
      nowServingToken: 0, waitingCount: 0, lanes: null,
    });
  }, 60_000);

  it('shows who is being served, how many wait, and a wait estimate', async () => {
    const salonId = await makeSalon({ average_service_minutes: 10 });
    for (let i = 0; i < 3; i++) expect((await joinViaApi(salonId)).status).toBe(201);

    const s = (await view(salonId)).body.salon;
    expect(s.nowServingToken).toBe(1); // the first customer started at once
    expect(s.waitingCount).toBe(2);
    expect(s.estimatedWaitMinutes).toBeGreaterThanOrEqual(10); // people are waiting, so a new customer waits
  }, 60_000);

  it('never carries names, phones, prizes or ticket tokens', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    await request(app).post('/api/barber/offers').set('Cookie', cookie).send({ name: 'Head massage', dailyCount: 50 });
    const d = customerDetails({ name: 'Zephyr Quillfeather' });
    const t = (await joinViaApi(salonId, d)).body.ticket;
    const { data: row } = await supabase.from('queue_entries').select('prize_code').eq('id', t.ticketId).single();

    const text = JSON.stringify((await view(salonId)).body);
    expect(text).not.toContain('Zephyr');
    expect(text).not.toContain(d.phone as string);
    expect(text).not.toContain(t.accessToken);
    expect(text).not.toContain(t.ticketId);
    if (row?.prize_code) expect(text).not.toContain(row.prize_code);
    expect(text).not.toMatch(/qr_code|qrCode|customer_?name|customer_?phone|access_?token/i);
    expect(JSON.parse(text).salon.phone).toBe('0000000000'); // only the salon's own number
  }, 60_000);

  it('follows the barber switch, pause and opening hours', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);

    await request(app).patch('/api/barber/salon').set('Cookie', cookie).send({ allowAppJoin: false });
    expect((await view(salonId)).body.salon.allowAppJoin).toBe(false);

    await joinViaApi(salonId); // a queue must exist for today
    expect((await request(app).post('/api/barber/queue/pause').set('Cookie', cookie)).status).toBe(200);
    expect((await view(salonId)).body.salon.isPaused).toBe(true);
    expect((await request(app).post('/api/barber/queue/resume').set('Cookie', cookie)).status).toBe(200);
    expect((await view(salonId)).body.salon.isPaused).toBe(false);

    const closed = await makeSalon(windowExcludingNow());
    expect((await view(closed)).body.salon.isOpen).toBe(false);
  }, 90_000);

  it('lists the barbers only when there is a choice', async () => {
    const salonId = await makeSalon({ average_service_minutes: 10 });
    const { data: lane, error } = await supabase
      .from('lanes').insert({ salon_id: salonId, name: 'Rahul' }).select('id').single();
    if (error) throw new Error(error.message);

    const s = (await view(salonId)).body.salon;
    expect(s.lanes).toHaveLength(2);
    expect(s.lanes.map((l: { name: string }) => l.name)).toContain('Rahul');
    for (const l of s.lanes) {
      expect(Object.keys(l).sort()).toEqual(['estimatedWaitMinutes', 'id', 'isPaused', 'name', 'waitingCount']);
    }

    expect((await joinViaApi(salonId, { laneId: lane!.id })).status).toBe(201); // Rahul busy
    expect((await joinViaApi(salonId, { laneId: lane!.id })).status).toBe(201); // one waiting for Rahul

    const after = (await view(salonId)).body.salon;
    const rahul = after.lanes.find((l: { id: string }) => l.id === lane!.id);
    const main = after.lanes.find((l: { id: string }) => l.id !== lane!.id);
    expect(rahul.waitingCount).toBe(1);
    expect(main.estimatedWaitMinutes).toBeLessThan(rahul.estimatedWaitMinutes);
    // "Any barber" wait = the shortest line, here the owner's empty one.
    expect(after.estimatedWaitMinutes).toBe(main.estimatedWaitMinutes);
  }, 90_000);

  it('unknown, malformed and suspended salons', async () => {
    expect((await view(randomUUID())).status).toBe(404);
    expect((await view('not-a-uuid')).status).toBe(400);

    const salonId = await makeSalon();
    await supabase.from('salons').update({ is_suspended: true }).eq('id', salonId);
    const res = await view(salonId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SALON_SUSPENDED');
    expect(res.body).not.toHaveProperty('salon');
  }, 60_000);
});
