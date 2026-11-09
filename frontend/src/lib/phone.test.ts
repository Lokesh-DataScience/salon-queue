// frontend/src/lib/phone.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeIndianMobile } from './phone';

describe('normalizeIndianMobile', () => {
  it('treats every common way of writing one number as the same number', () => {
    for (const written of ['9876543210', '98765 43210', '+91 98765-43210', '09876543210', '919876543210', '(+91) 98765 43210']) {
      expect(normalizeIndianMobile(written), written).toBe('9876543210');
    }
  });

  it('rejects anything that is not a 10-digit mobile starting 6-9', () => {
    for (const bad of ['', '12345', '98765432', '98765432100', '5876543210', 'abcdefghij', '+1 415 555 0100']) {
      expect(normalizeIndianMobile(bad), bad).toBeNull();
    }
  });
});