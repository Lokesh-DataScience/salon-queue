// backend/tests/registerValidator.test.ts
// Pure Zod checks for registration (step18): mobile number login, no email, location optional (permission may be denied).
import { describe, expect, it } from 'vitest';
import { registerSalonBodySchema } from '../src/validators/auth.validators';

const base = {
  salonName: 'Milan Hair Salon',
  phone: '98765 43210',
  address: 'Main Road, Korba',
  latitude: 22.35,
  longitude: 82.68,
  ownerName: 'Ramesh',
  password: '123456',
};

describe('registerSalonBodySchema', () => {
  it('accepts a salon with no email, and normalizes the number', () => {
    const r = registerSalonBodySchema.safeParse(base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.phone).toBe('+919876543210');
    expect(r.data.openingTime).toBe('09:00');
    expect(r.data.averageServiceMinutes).toBe(15);
  });

  it('accepts the usual ways of typing an Indian mobile', () => {
    for (const phone of ['9876543210', '09876543210', '+91 98765-43210', '919876543210']) {
      const r = registerSalonBodySchema.safeParse({ ...base, phone });
      expect(r.success && r.data.phone).toBe('+919876543210');
    }
  });

  it('rejects a number that is not a mobile', () => {
    const r = registerSalonBodySchema.safeParse({ ...base, phone: '12345' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0].path).toEqual(['phone']);
  });

  it('registers without a location when permission was denied', () => {
    const { latitude: _lat, longitude: _lng, ...noLocation } = base;
    const r = registerSalonBodySchema.safeParse(noLocation);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.latitude).toBeUndefined();
    expect(r.data.longitude).toBeUndefined();
  });

  it('takes latitude and longitude together, never one alone', () => {
    const { longitude: _lng, ...half } = base;
    const r = registerSalonBodySchema.safeParse(half);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0].path).toEqual(['latitude']);
  });

  it('needs at least 6 password characters', () => {
    expect(registerSalonBodySchema.safeParse({ ...base, password: '12345' }).success).toBe(false);
    expect(registerSalonBodySchema.safeParse({ ...base, password: '123456' }).success).toBe(true);
  });

  it('ignores an email sent by an old page instead of requiring it', () => {
    const r = registerSalonBodySchema.safeParse({ ...base, email: 'old@example.com' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect('email' in r.data).toBe(false);
  });
});