// backend/tests/qr.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor, joinViaApi } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

async function codeOf(salonId: string): Promise<string> {
  const { data, error } = await supabase.from('salons').select('qr_code').eq('id', salonId).single();
  if (error) throw new Error(error.message);
  return data!.qr_code as string;
}

describe('Salon QR codes', () => {
  it('gives every new salon its own 12-character code automatically', async () => {
    const a = await makeSalon();
    const b = await makeSalon();
    const [ca, cb] = [await codeOf(a), await codeOf(b)];
    expect(ca).toMatch(/^[a-z0-9]{12}$/);
    expect(cb).toMatch(/^[a-z0-9]{12}$/);
    expect(ca).not.toBe(cb);
  });

  it('resolves a code to the salon id and name, and nothing else', async () => {
    const salonId = await makeSalon();
    const res = await request(app).get(`/api/salons/by-code/${await codeOf(salonId)}`);
    expect(res.status).toBe(200);
    expect(res.body.salon.id).toBe(salonId);
    expect(Object.keys(res.body.salon).sort()).toEqual(['id', 'name']);
  });

  it('ignores letter case in the code', async () => {
    const salonId = await makeSalon();
    const res = await request(app).get(`/api/salons/by-code/${(await codeOf(salonId)).toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(res.body.salon.id).toBe(salonId);
  });

  it.each(['abcdefabcdef', 'nope', 'a'.repeat(40), 'ab-cd-ef-gh-ij', '%20%20%20%20%20%20%20%20'])(
    'answers 404 for the unknown or malformed code %s',
    async (code) => {
      const res = await request(app).get(`/api/salons/by-code/${code}`);
      expect(res.status).toBe(404);
    },
  );

  it('never shows the code on the public salon routes', async () => {
    const salonId = await makeSalon();
    const code = await codeOf(salonId);

    const details = await request(app).get(`/api/salons/${salonId}`);
    expect(details.status).toBe(200);
    expect(JSON.stringify(details.body)).not.toContain(code);
    expect(details.body.salon).not.toHaveProperty('qr_code');

    const nearby = await request(app).get('/api/salons/nearby').query({ lat: 23.2599, lng: 77.4126, radiusKm: 5 });
    expect(nearby.status).toBe(200);
    expect(JSON.stringify(nearby.body)).not.toContain(code);
  });

  it('a scan leads to a real ticket: look up the salon, then join', async () => {
    const salonId = await makeSalon();
    const lookup = await request(app).get(`/api/salons/by-code/${await codeOf(salonId)}`);
    const join = await joinViaApi(lookup.body.salon.id);
    expect([200, 201]).toContain(join.status);
    expect(join.body.ticket.tokenNumber).toBe(1);
  });
});

describe('Barber QR endpoint', () => {
  it('requires a login', async () => {
    const res = await request(app).get('/api/barber/salon');
    expect(res.status).toBe(401);
  });

  it("returns the barber's own salon code, and ignores any attempt to ask for another salon", async () => {
    const mine = await makeSalon();
    const other = await makeSalon();
    const cookie = await barberCookieFor(mine);

    const res = await request(app).get('/api/barber/salon').query({ salonId: other }).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.salon.id).toBe(mine);
    expect(res.body.salon.qrCode).toBe(await codeOf(mine));
    expect(res.body.salon.qrCode).not.toBe(await codeOf(other));
    expect(res.headers['cache-control']).toContain('no-store');
  });
});
