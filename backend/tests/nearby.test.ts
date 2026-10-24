import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, joinViaApi } from './helpers';
import { callNext } from '../src/services/barber.service';

afterAll(cleanupSalons);

const HOME = { latitude: -45.0, longitude: 170.0 }; // empty area of the map: only our test rows are here
const nearby = (radiusKm: number) =>
  request(app).get('/api/salons/nearby').query({ lat: HOME.latitude, lng: HOME.longitude, radiusKm });

describe('Nearby salons', () => {
  it('lists salons within the radius, nearest first, with queue size and wait', async () => {
    const near = await makeSalon({ ...HOME, average_service_minutes: 10 });
    const mid = await makeSalon({ latitude: -45.0, longitude: 170.03 }); // about 2.4 km east
    const far = await makeSalon({ latitude: -45.0, longitude: 170.2 }); // about 16 km east
    await joinViaApi(near, 'One');
    await joinViaApi(near, 'Two');

    const res = await nearby(5);
    expect(res.status).toBe(200);
    const ids = res.body.salons.map((s: { id: string }) => s.id);
    expect(ids).toEqual([near, mid]); // far excluded, nearest first

    const [a, b] = res.body.salons;
    expect(a.distance_km).toBeLessThan(0.1);
    expect(b.distance_km).toBeGreaterThan(2);
    expect(b.distance_km).toBeLessThan(3);
    expect(a.queue_size).toBe(2);
    expect(a.estimated_wait_minutes).toBe(20);
    expect(a.is_open).toBe(true);

    const wide = await nearby(25);
    expect(wide.body.salons.map((s: { id: string }) => s.id)).toContain(far);
  });

  it('still lists a closed salon, marked as closed', async () => {
    const closed = await makeSalon({ ...HOME, is_open: false });
    const res = await nearby(5);
    const row = res.body.salons.find((s: { id: string }) => s.id === closed);
    expect(row).toBeDefined();
    expect(row.is_open).toBe(false);
  });

  it('counts only people still waiting, not the one already called', async () => {
    const salonId = await makeSalon({ ...HOME });
    await joinViaApi(salonId, 'First');
    await joinViaApi(salonId, 'Second');
    await callNext(salonId); // first is now CALLED

    const row = (await nearby(5)).body.salons.find((s: { id: string }) => s.id === salonId);
    expect(row.queue_size).toBe(1);
  });
});