import { describe, it, expect } from 'vitest';
import { joinQueueBodySchema } from '../src/validators/queue.validators';

describe('Join validation', () => {
  it('accepts an empty body', () => {
    expect(joinQueueBodySchema.safeParse({}).success).toBe(true);
  });
  it('strips any personal details a client sends', () => {
    expect(joinQueueBodySchema.parse({ name: 'Asha', phone: '9876543210' })).toEqual({});
  });
});