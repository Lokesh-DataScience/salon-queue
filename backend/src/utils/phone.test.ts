// backend/src/utils/phone.test.ts
import { describe, it, expect } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
    ['+14155552671', '+14155552671'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '12345', '5876543210', '98765432101234', 'owner@salon.test'])(
    'rejects %s',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});