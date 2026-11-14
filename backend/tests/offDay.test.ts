// backend/tests/offDay.test.ts — Weekly off day, Slice 1 (backend).
// Needs step19_weekly_off_days.sql applied to the tests project. Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor, joinViaApi, customerDetails } from './helpers';
import { supabase } from '../src/config/supabase';
import { isOffDay, istWeekday } from '../src/utils/hours';
import { updateSalonProfileBodySchema as schema } from '../src/validators/salonProfile.validators';

afterAll(cleanupSalons);

const today = istWeekday(); // India time, 0 = Sunday
const notToday = (today + 3) % 7;

const setOffDays = (cookie: string, weeklyOffDays: unknown) =>
  request(app).patch('/api/barber/salon').set('Cookie', cookie).send({ weeklyOffDays });

async function ticketCount(salonId: string) {
  const { data } = await supabase.from('queue_entries').select('id, queues!inner(salon_id)').eq('queues.salon_id', salonId);
  return (data ?? []).length;
}

describe('isOffDay (India time)', () => {
  it('changes day at midnight India time, not UTC', () => {
    // 2026-01-05 is a Monday (1), 2026-01-06 a Tuesday (2). Midnight in India is 18:30 UTC the day before.
    const lastSecondOfMonday = new Date('2026-01-05T18:29:59Z');
    const firstSecondOfTuesday = new Date('2026-01-05T18:30:00Z');
    expect(isOffDay([2], lastSecondOfMonday)).toBe(false);
    expect(isOffDay([1], lastSecondOfMonday)).toBe(true);
    expect(isOffDay([2], firstSecondOfTuesday)).toBe(true);
  });

  it('no off days never blocks', () => {
    expect(isOffDay([], new Date())).toBe(false);
    expect(isOffDay(null, new Date())).toBe(false);
    expect(isOffDay(undefined, new Date())).toBe(false);
  });
});

describe('weeklyOffDays validation', () => {
  it('accepts days, removes repeats and sorts them', () => {
    expect(schema.parse({ weeklyOffDays: [5, 2, 2] })).toEqual({ weeklyOffDays: [2, 5] });
    expect(schema.parse({ weeklyOffDays: [] })).toEqual({ weeklyOffDays: [] });
  });

  it('rejects impossible days and closing all week', () => {
    for (const bad of [[7], [-1], [1.5], ['2'], 'tuesday', null, [0, 1, 2, 3, 4, 5, 6]]) {
      expect(schema.safeParse({ weeklyOffDays: bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('Weekly off day (database + API)', () => {
  it('the owner sets off days in Settings and gets them back; staff cannot', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);

    const before = await request(app).get('/api/barber/salon').set('Cookie', cookie);
    expect(before.body.salon.weeklyOffDays).toEqual([]); // existing salons: open every day

    const res = await setOffDays(cookie, [5, 2]);
    expect(res.status).toBe(200);
    expect(res.body.salon.weeklyOffDays).toEqual([2, 5]);

    expect((await setOffDays(cookie, [0, 1, 2, 3, 4, 5, 6])).status).toBe(400);

    const staff = await barberCookieFor(salonId, 'BARBER');
    expect((await setOffDays(staff, [1])).status).toBe(403);

    const after = await request(app).get('/api/barber/salon').set('Cookie', cookie);
    expect(after.body.salon.weeklyOffDays).toEqual([2, 5]); // the refused requests changed nothing
  }, 60_000);

  it('on the off day customers cannot join, from the wall QR or the app', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    expect((await setOffDays(cookie, [today])).status).toBe(200);

    const qr = await joinViaApi(salonId);
    expect(qr.status).toBe(409);
    expect(qr.body.message).toBe('Salon is currently closed.');

    const fromApp = await request(app)
      .post(`/api/queues/${salonId}/join`)
      .send({ ...customerDetails(), source: 'app' });
    expect(fromApp.status).toBe(409);

    expect(await ticketCount(salonId)).toBe(0);
  }, 60_000);

  it('the barber can still add a walk-in on the off day (he decided to open anyway)', async () => {
    const salonId = await makeSalon({ weekly_off_days: [today] });
    const cookie = await barberCookieFor(salonId);
    const walk = await request(app).post('/api/barber/queue/walk-in').set('Cookie', cookie);
    expect(walk.status).toBe(201);
  }, 60_000);

  it('a different off day changes nothing today, and clearing the off day reopens joins', async () => {
    const other = await makeSalon({ weekly_off_days: [notToday] });
    expect((await joinViaApi(other)).status).toBe(201);

    const salonId = await makeSalon({ weekly_off_days: [today] });
    expect((await joinViaApi(salonId)).status).toBe(409);
    const cookie = await barberCookieFor(salonId);
    expect((await setOffDays(cookie, [])).status).toBe(200);
    expect((await joinViaApi(salonId)).status).toBe(201);
  }, 60_000);

  it('public pages show the salon as closed today, and why', async () => {
    const coords = { latitude: -45.5, longitude: 170.5 };
    const closed = await makeSalon({ ...coords, weekly_off_days: [today] });
    const open = await makeSalon({ ...coords, weekly_off_days: [notToday] });

    const details = (await request(app).get(`/api/salons/${closed}`)).body.salon;
    expect(details.is_open).toBe(false);
    expect(details.is_off_day).toBe(true);
    expect(details.weekly_off_days).toEqual([today]);
    expect((await request(app).get(`/api/salons/${open}`)).body.salon.is_off_day).toBe(false);

    const pub = (await request(app).get(`/api/salons/${closed}/queue-public`)).body.salon;
    expect(pub.isOpen).toBe(false);
    expect(pub.isOffDay).toBe(true);
    expect(pub.weeklyOffDays).toEqual([today]);
    const pubOpen = (await request(app).get(`/api/salons/${open}/queue-public`)).body.salon;
    expect(pubOpen.isOpen).toBe(true);
    expect(pubOpen.isOffDay).toBe(false);

    const nearby = await request(app).get('/api/salons/nearby').query({ lat: -45.5, lng: 170.5, radiusKm: 5 });
    const byId = (id: string) => nearby.body.salons.find((s: { id: string }) => s.id === id);
    expect(byId(closed).is_open).toBe(false);
    expect(byId(open).is_open).toBe(true);
  }, 60_000);

  it('the database itself refuses impossible day lists', async () => {
    const salonId = await makeSalon();
    for (const bad of [[7], [-1], [0, 1, 2, 3, 4, 5, 6]]) {
      const { error } = await supabase.from('salons').update({ weekly_off_days: bad }).eq('id', salonId);
      expect(error, JSON.stringify(bad)).not.toBeNull();
    }
  }, 60_000);
});