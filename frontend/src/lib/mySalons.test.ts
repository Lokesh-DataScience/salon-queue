// frontend/src/lib/mySalons.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getMySalons, saveMySalon, removeMySalon } from './mySalons';

const KEY = 'svq.mysalons.v1';

describe('mySalons', () => {
  it('saves newest first, one entry per salon, and the code in lower case', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveMySalon({ salonId: 's1', code: 'ABCDEF123456', name: 'Milan Hair Salon' });
    vi.setSystemTime(2000);
    saveMySalon({ salonId: 's2', code: 'bbbbbbbbbbbb', name: 'Second Salon' });
    vi.setSystemTime(3000);
    saveMySalon({ salonId: 's1', code: 'abcdef123456', name: 'Milan Hair Salon' }); // scanned again
    vi.useRealTimers();

    expect(getMySalons().map((s) => s.salonId)).toEqual(['s1', 's2']);
    expect(getMySalons()[0].code).toBe('abcdef123456');
  });

  it('stores only salon id, code, name and time (nothing about the customer)', () => {
    saveMySalon({ salonId: 's1', code: 'abcdef123456', name: 'Milan Hair Salon' });
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(Object.keys(raw[0]).sort()).toEqual(['code', 'lastVisitedAt', 'name', 'salonId']);
  });

  it('removes a salon', () => {
    saveMySalon({ salonId: 's1', code: 'abcdef123456', name: 'A' });
    saveMySalon({ salonId: 's2', code: 'bbbbbbbbbbbb', name: 'B' });
    removeMySalon('s1');
    expect(getMySalons().map((s) => s.salonId)).toEqual(['s2']);
  });

  it('ignores a bad code, survives corrupt storage, and keeps 20 at most', () => {
    saveMySalon({ salonId: 's1', code: 'no spaces!', name: 'A' });
    expect(getMySalons()).toEqual([]);
    localStorage.setItem(KEY, '{broken');
    expect(getMySalons()).toEqual([]);
    for (let i = 0; i < 25; i++) saveMySalon({ salonId: `s${i}`, code: `code${String(i).padStart(8, '0')}`, name: `S${i}` });
    expect(getMySalons()).toHaveLength(20);
  });

  it('never throws when storage is unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveMySalon({ salonId: 's1', code: 'abcdef123456', name: 'A' })).not.toThrow();
    expect(getMySalons()).toEqual([]);
    get.mockRestore();
    set.mockRestore();
  });
});
