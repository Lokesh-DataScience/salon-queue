// backend/tests/validators.test.ts
import { describe, it, expect } from 'vitest';
import { joinQueueBodySchema } from '../src/validators/queue.validators';

describe('Join validation', () => {
  it('accepts an empty body (a phone the salon already knows sends only its remember token, or nothing)', () => {
    expect(joinQueueBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts name, phone and consent, and stores the phone one way', () => {
    const body = joinQueueBodySchema.parse({ name: '  Harshita   Pande ', phone: '+91 98765-43210', consent: true });
    expect(body).toEqual({ name: 'Harshita Pande', phone: '9876543210', consent: true });
  });

  it('rejects a phone that is not an Indian mobile number', () => {
    for (const phone of ['12345', '5876543210', 'abcdefghij', '98765432101234']) {
      expect(joinQueueBodySchema.safeParse({ name: 'Harshita', phone }).success).toBe(false);
    }
  });

  it('rejects an empty or markup-laden name', () => {
    expect(joinQueueBodySchema.safeParse({ name: '   ', phone: '9876543210' }).success).toBe(false);
    expect(joinQueueBodySchema.safeParse({ name: '<script>', phone: '9876543210' }).success).toBe(false);
  });

  it('only accepts a 64-character hex remember token', () => {
    expect(joinQueueBodySchema.safeParse({ rememberToken: 'a'.repeat(64) }).success).toBe(true);
    expect(joinQueueBodySchema.safeParse({ rememberToken: 'a'.repeat(63) }).success).toBe(false);
    expect(joinQueueBodySchema.safeParse({ rememberToken: 'Z'.repeat(64) }).success).toBe(false);
  });

  it('still drops fields it does not know about (a client cannot send its own salon, status or position)', () => {
    const body = joinQueueBodySchema.parse({ salonId: 'x', status: 'SERVING', position: 1, customerPhone: '9876543210' });
    expect(body).toEqual({});
  });
});