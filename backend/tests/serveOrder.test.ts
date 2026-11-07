// backend/tests/serveOrder.test.ts
import { describe, it, expect } from 'vitest';
import { compareServeOrder } from '../src/utils/serveOrder';

const e = (token: number, status = 'WAITING', priority_at: string | null = null) => ({
  token_number: token, status, priority_at,
});
const order = (list: ReturnType<typeof e>[]) => [...list].sort(compareServeOrder).map((x) => x.token_number);

describe('compareServeOrder', () => {
  it('keeps token order when nobody is moved up', () => {
    expect(order([e(5), e(3), e(4)])).toEqual([3, 4, 5]);
  });

  it('serving and called come before waiting, even with a higher token', () => {
    expect(order([e(3), e(8, 'SERVING'), e(4), e(6, 'CALLED')])).toEqual([8, 6, 3, 4]);
  });

  it('your scenario: #2 serving, #8 moved up, then 3, 4, 5...', () => {
    const list = [e(2, 'SERVING'), e(3), e(4), e(5), e(8, 'WAITING', '2026-01-01T10:00:00Z')];
    expect(order(list)).toEqual([2, 8, 3, 4, 5]);
  });

  it('a second emergency stays behind the first', () => {
    const list = [
      e(3),
      e(9, 'WAITING', '2026-01-01T10:05:00Z'),
      e(8, 'WAITING', '2026-01-01T10:00:00Z'),
    ];
    expect(order(list)).toEqual([8, 9, 3]);
  });

  it('after the emergency is served, the queue resumes in token order', () => {
    expect(order([e(8, 'SERVING', '2026-01-01T10:00:00Z'), e(3), e(4)])).toEqual([8, 3, 4]);
  });
});