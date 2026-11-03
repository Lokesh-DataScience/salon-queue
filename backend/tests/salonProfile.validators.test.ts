// backend/tests/salonProfile.validators.test.ts
import { describe, it, expect } from 'vitest';
import { updateSalonProfileBodySchema as schema } from '../src/validators/salonProfile.validators';

describe('updateSalonProfileBodySchema', () => {
  it('accepts a partial update', () => {
    expect(schema.parse({ averageServiceMinutes: 20 })).toEqual({ averageServiceMinutes: 20 });
  });

  it('normalizes the phone number', () => {
    expect(schema.parse({ phone: '+91 98765-43210' }).phone).toBe('+919876543210');
  });

  it('rejects an empty body', () => {
    expect(() => schema.parse({})).toThrow();
  });

  it('rejects fields the barber must not change', () => {
    expect(() => schema.parse({ salonId: 'x', name: 'Ok name' })).toThrow();
    expect(() => schema.parse({ isOpen: true })).toThrow();
    expect(() => schema.parse({ qrCode: 'abc' })).toThrow();
  });

  it('rejects bad times and out-of-range service minutes', () => {
    expect(() => schema.parse({ openingTime: '9am' })).toThrow();
    expect(() => schema.parse({ averageServiceMinutes: 0 })).toThrow();
    expect(() => schema.parse({ averageServiceMinutes: 241 })).toThrow();
    expect(() => schema.parse({ averageServiceMinutes: 12.5 })).toThrow();
  });
});