// backend/tests/hours.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, joinViaApi } from './helpers';
import { isWithinHours } from '../src/utils/hours';

afterAll(cleanupSalons);

const at = (utc: string) => new Date(`2026-01-01T${utc}Z`);

// A one-hour window that cannot contain "now" (India time).
function windowExcludingNow() {
  const ist = new Date(Date.now() + 330 * 60_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return mins + 180 < 1440
    ? { opening_time: fmt(mins + 120), closing_time: fmt(mins + 180) }
    : { opening_time: fmt(mins - 180), closing_time: fmt(mins - 120) };
}

describe('isWithinHours (India time)', () => {
  it('includes the opening and closing minute and excludes the minutes just outside', () => {
    // 09:00 IST = 03:30 UTC, 21:00 IST = 15:30 UTC
    expect(isWithinHours('09:00', '21:00', at('03:29:59'))).toBe(false);
    expect(isWithinHours('09:00', '21:00', at('03:30:00'))).toBe(true);
    expect(isWithinHours('09:00', '21:00', at('15:30:45'))).toBe(true); // still the 21:00 minute
    expect(isWithinHours('09:00', '21:00', at('15:31:00'))).toBe(false);
  });

  it('never blocks on a window it cannot interpret', () => {
    expect(isWithinHours('22:00', '02:00', at('10:00:00'))).toBe(true);
    expect(isWithinHours('soon', 'later', at('10:00:00'))).toBe(true);
  });
});

describe('Opening hours in the database', () => {
  it('refuses a join outside opening hours with the closed message', async () => {
    const salonId = await makeSalon(windowExcludingNow());
    const res = await joinViaApi(salonId);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Salon is currently closed.');
  });

  it('shows a salon outside its hours as closed in nearby search and in its details', async () => {
    const coords = { latitude: -46.0, longitude: 171.0 };
    const closed = await makeSalon({ ...coords, ...windowExcludingNow() });
    const open = await makeSalon({ ...coords }); // default hours are 00:00 to 23:59

    const nearby = await request(app).get('/api/salons/nearby').query({ lat: -46.0, lng: 171.0, radiusKm: 5 });
    const byId = (id: string) => nearby.body.salons.find((s: { id: string }) => s.id === id);
    expect(byId(closed).is_open).toBe(false);
    expect(byId(open).is_open).toBe(true);

    expect((await request(app).get(`/api/salons/${closed}`)).body.salon.is_open).toBe(false);
    expect((await request(app).get(`/api/salons/${open}`)).body.salon.is_open).toBe(true);
  });
});