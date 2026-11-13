import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearVisits, getVisits, MAX_VISITS, recordVisit } from './visitHistory';

const visit = (i: number, status = 'COMPLETED') => ({
  ticketId: `t${i}`,
  salonId: 's1',
  salonName: 'Milan Hair Salon',
  salonCode: 'ABCDEF123456',
  tokenNumber: i,
  status,
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000);
});

describe('visit history', () => {
  it('records a finished visit with salon details only, code lower-cased', () => {
    recordVisit(visit(7));
    expect(getVisits()).toEqual([
      { ticketId: 't7', salonId: 's1', salonName: 'Milan Hair Salon', salonCode: 'abcdef123456', tokenNumber: 7, outcome: 'COMPLETED', at: 1_000 },
    ]);
    const raw = localStorage.getItem('svq.history.v1')!;
    expect(raw).not.toMatch(/accessToken|phone|customer/i);
  });

  it('ignores tickets that are still active, and records each visit once', () => {
    recordVisit(visit(1, 'WAITING'));
    recordVisit(visit(2, 'SKIPPED'));
    recordVisit(visit(2, 'SKIPPED'));
    expect(getVisits().map((v) => v.ticketId)).toEqual(['t2']);
  });

  it('keeps the newest 50', () => {
    for (let i = 1; i <= MAX_VISITS + 5; i++) {
      vi.setSystemTime(i * 1000);
      recordVisit(visit(i));
    }
    const all = getVisits();
    expect(all).toHaveLength(50);
    expect(all[0].tokenNumber).toBe(55);
    expect(all[49].tokenNumber).toBe(6);
  });

  it('drops an unusable salon code but keeps the visit', () => {
    recordVisit({ ...visit(3), salonCode: 'bad code!' });
    expect(getVisits()[0]).not.toHaveProperty('salonCode');
  });

  it('can be cleared, and survives corrupt storage', () => {
    recordVisit(visit(1));
    clearVisits();
    expect(getVisits()).toEqual([]);
    localStorage.setItem('svq.history.v1', '{not json');
    expect(getVisits()).toEqual([]);
  });
});
