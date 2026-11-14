// frontend/src/lib/salonInfo.offday.test.ts — weekly off day names.
import { describe, it, expect } from 'vitest';
import { formatDays } from './salonInfo';

describe('formatDays', () => {
  it('names one day in Hindi and English', () => {
    expect(formatDays([2], 'hi')).toBe('मंगलवार');
    expect(formatDays([2], 'en')).toBe('Tuesday');
  });

  it('lists several days Monday first, Sunday last, joined with "and"', () => {
    expect(formatDays([0, 2], 'en')).toBe('Tuesday and Sunday');
    expect(formatDays([0, 2], 'hi')).toBe('मंगलवार और रविवार');
    expect(formatDays([6, 1, 3], 'en')).toBe('Monday, Wednesday and Saturday');
  });

  it('ignores repeats and impossible values; nothing left means null', () => {
    expect(formatDays([2, 2, 9, -1], 'en')).toBe('Tuesday');
    expect(formatDays([], 'en')).toBeNull();
    expect(formatDays(null, 'hi')).toBeNull();
    expect(formatDays(undefined, 'hi')).toBeNull();
  });
});
