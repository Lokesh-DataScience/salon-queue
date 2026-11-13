// backend/tests/servicePrices.unit.test.ts
// Customer app polish, slice 2: service prices (validators) and the salon info on queue-public.
// Pure unit tests: no database needed.
import { describe, it, expect } from 'vitest';
import { createServiceSchema, updateServiceSchema } from '../src/validators/barber.validators';
import { publicSalonInfo } from '../src/utils/salonInfo';

describe('service price validation', () => {
  it('a service can be created without a price, as before', () => {
    expect(createServiceSchema.parse({ name: 'Haircut', durationMinutes: 20 })).toEqual({
      name: 'Haircut',
      durationMinutes: 20,
    });
  });

  it('accepts a whole-rupee price, including 0', () => {
    expect(createServiceSchema.parse({ name: 'Haircut', durationMinutes: 20, priceRupees: 100 }).priceRupees).toBe(100);
    expect(createServiceSchema.parse({ name: 'Wash', durationMinutes: 5, priceRupees: 0 }).priceRupees).toBe(0);
  });

  it('rejects paise, negative, huge and text prices', () => {
    for (const priceRupees of [99.5, -1, 100001, '100']) {
      expect(createServiceSchema.safeParse({ name: 'Haircut', durationMinutes: 20, priceRupees }).success).toBe(false);
    }
  });

  it('null clears a price on update, and a price alone is a valid update', () => {
    expect(updateServiceSchema.parse({ priceRupees: null })).toEqual({ priceRupees: null });
    expect(updateServiceSchema.parse({ priceRupees: 150 })).toEqual({ priceRupees: 150 });
  });

  it('an empty update is still refused', () => {
    expect(updateServiceSchema.safeParse({}).success).toBe(false);
  });

  it('unknown keys are still refused', () => {
    expect(createServiceSchema.safeParse({ name: 'Haircut', durationMinutes: 20, salonId: 'x' }).success).toBe(false);
  });
});

describe('publicSalonInfo', () => {
  const row = {
    address: '  12 Main Road, Bilaspur ',
    phone: '9876543210',
    opening_time: '9:00',
    closing_time: '21:30:00',
    latitude: 22.08,
    longitude: 82.15,
  };

  it('returns the salon contact details, trimmed, with HH:mm times', () => {
    expect(publicSalonInfo(row)).toEqual({
      address: '12 Main Road, Bilaspur',
      phone: '9876543210',
      openingTime: '09:00',
      closingTime: '21:30',
      location: { lat: 22.08, lng: 82.15 },
    });
  });

  it('leaves out a location that was never set (0,0) or is invalid', () => {
    expect(publicSalonInfo({ ...row, latitude: 0, longitude: 0 }).location).toBeNull();
    expect(publicSalonInfo({ ...row, latitude: null, longitude: 82 }).location).toBeNull();
    expect(publicSalonInfo({ ...row, latitude: 200, longitude: 82 }).location).toBeNull();
  });

  it('accepts numeric strings for the location (Postgres numeric)', () => {
    expect(publicSalonInfo({ ...row, latitude: '22.5', longitude: '82.1' }).location).toEqual({ lat: 22.5, lng: 82.1 });
  });

  it('turns empty or unreadable values into null', () => {
    expect(
      publicSalonInfo({ address: '  ', phone: '', opening_time: 'later', closing_time: null }),
    ).toEqual({ address: null, phone: null, openingTime: null, closingTime: null, location: null });
  });
});
