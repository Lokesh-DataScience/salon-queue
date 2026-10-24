// backend/tests/validators.test.ts
import { describe, it, expect } from 'vitest';
import { joinQueueBodySchema } from '../src/validators/queue.validators';

const parse = (name: string, phone: string) => joinQueueBodySchema.safeParse({ name, phone });

describe('Join validation', () => {
  it('accepts phone numbers the way people really type them, and normalizes them', () => {
    expect(parse('A', '98765 43210')).toMatchObject({ success: true, data: { phone: '9876543210' } });
    expect(parse('A', '+91 98765-43210')).toMatchObject({ success: true, data: { phone: '+919876543210' } });
    expect(parse('A', '(+91) 98765 43210')).toMatchObject({ success: true, data: { phone: '+919876543210' } });
  });

  it('rejects bad phones and names with field-level messages', () => {
    for (const bad of ['abc', '12345', '98765 4321 0 0 0 0 0 0 0']) {
      expect(parse('A', bad).success).toBe(false);
    }
    const r = parse('', 'nope');
    expect(r.success).toBe(false);
    if (!r.success) {
      const f = r.error.flatten().fieldErrors;
      expect(f.name?.[0]).toBe('Enter your name');
      expect(f.phone?.[0]).toBe('Enter a valid mobile number');
    }
    expect(parse('x'.repeat(81), '9876543210').success).toBe(false);
  });
});