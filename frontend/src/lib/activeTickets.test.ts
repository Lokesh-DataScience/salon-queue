import { describe, it, expect, vi } from 'vitest';
import { getTickets, saveTicket, removeTicket } from './activeTickets';

const KEY = 'svq.tickets.v1';
const ticket = (id: string, salonId = 's1') => ({
  ticketId: id,
  accessToken: `token-${id}`,
  salonId,
  tokenNumber: 1,
});

describe('activeTickets', () => {
  it('stores nothing but the five ticket fields (no name, no phone)', () => {
    saveTicket(ticket('a'));
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(Object.keys(raw[0]).sort()).toEqual(['accessToken', 'salonId', 'savedAt', 'ticketId', 'tokenNumber']);
  });

  it('round-trips, filters by salon, replaces on re-save, and removes', () => {
    saveTicket(ticket('a', 's1'));
    saveTicket(ticket('b', 's2'));
    saveTicket({ ...ticket('a', 's1'), tokenNumber: 9 });
    expect(getTickets()).toHaveLength(2);
    expect(getTickets('s1').map((t) => t.tokenNumber)).toEqual([9]);
    removeTicket('a');
    expect(getTickets().map((t) => t.ticketId)).toEqual(['b']);
  });

  it('ignores tickets older than 24 hours', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { ...ticket('old'), savedAt: Date.now() - 25 * 3_600_000 },
        { ...ticket('fresh'), savedAt: Date.now() },
      ]),
    );
    expect(getTickets().map((t) => t.ticketId)).toEqual(['fresh']);
  });

  it('survives corrupt or malformed storage', () => {
    localStorage.setItem(KEY, 'garbage');
    expect(getTickets()).toEqual([]);
    localStorage.setItem(KEY, '{"a":1}');
    expect(getTickets()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify([null, { ticketId: 1 }, { ...ticket('ok'), savedAt: Date.now() }]));
    expect(getTickets().map((t) => t.ticketId)).toEqual(['ok']);
  });

  it('keeps only the newest five', () => {
    for (let i = 1; i <= 7; i++) saveTicket(ticket(`t${i}`));
    expect(getTickets().map((t) => t.ticketId)).toEqual(['t3', 't4', 't5', 't6', 't7']);
  });

  it('never throws when storage is unavailable', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveTicket(ticket('a'))).not.toThrow();
    expect(getTickets()).toEqual([]);
    set.mockRestore();
    get.mockRestore();
  });
});