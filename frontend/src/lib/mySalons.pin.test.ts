import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getMySalons, isSalonPinned, removeMySalon, saveMySalon, setSalonPinned } from './mySalons';

function addAt(time: number, id: string) {
  vi.setSystemTime(time);
  saveMySalon({ salonId: id, code: `code${id}0000`, name: `Salon ${id}` });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
});

describe('pinned salons', () => {
  it('a pinned salon stays at the top, even when others are newer', () => {
    addAt(1000, 'a');
    addAt(2000, 'b');
    addAt(3000, 'c');
    setSalonPinned('a', true);
    expect(getMySalons().map((s) => s.salonId)).toEqual(['a', 'c', 'b']);
    expect(isSalonPinned('a')).toBe(true);
    expect(isSalonPinned('b')).toBe(false);
  });

  it('scanning a pinned salon again keeps its pin', () => {
    addAt(1000, 'a');
    setSalonPinned('a', true);
    addAt(5000, 'a');
    expect(isSalonPinned('a')).toBe(true);
  });

  it('unpinning puts it back in visit order and leaves no pinned flag behind', () => {
    addAt(1000, 'a');
    addAt(2000, 'b');
    setSalonPinned('a', true);
    setSalonPinned('a', false);
    expect(getMySalons().map((s) => s.salonId)).toEqual(['b', 'a']);
    expect(JSON.parse(localStorage.getItem('svq.mysalons.v1')!)[1]).not.toHaveProperty('pinned');
  });

  it('when the list is full, an old pinned salon is kept and the oldest unpinned one drops off', () => {
    addAt(1, 'p');
    setSalonPinned('p', true);
    for (let i = 0; i < 20; i++) addAt(100 + i, `n${i}`);
    const ids = getMySalons().map((s) => s.salonId);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe('p');
    expect(ids).not.toContain('n0');
  });

  it('removing a pinned salon removes it', () => {
    addAt(1000, 'a');
    setSalonPinned('a', true);
    removeMySalon('a');
    expect(getMySalons()).toEqual([]);
  });

  it('ignores a corrupt pinned value instead of crashing', () => {
    localStorage.setItem(
      'svq.mysalons.v1',
      JSON.stringify([{ salonId: 'x', code: 'abcdefgh1234', name: 'X', lastVisitedAt: 1, pinned: 'yes' }]),
    );
    expect(getMySalons()).toEqual([]);
  });
});
