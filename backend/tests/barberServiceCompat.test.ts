// backend/tests/barberServiceCompat.test.ts
// No database needed. Locks in that the service functions still accept a plain salon id
// (the way the older tests and callers use them) as well as the new barber scope.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../src/config/supabase', () => {
  const chain: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any) => res({ data: [], error: null });
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: null, error: null });
      return () => chain;
    },
  });
  return { supabase: { from: () => chain, rpc: (...a: unknown[]) => rpc(...a) } };
});

import { callNext, addWalkIn, getBarberQueueSnapshot } from '../src/services/barber.service';

beforeEach(() => rpc.mockReset());

describe('barber service accepts a plain salon id, as before', () => {
  it('callNext(salonId) calls barber_next for that salon, on the default line', async () => {
    rpc.mockResolvedValue({ data: [{ called_entry_id: 'e1', called_token_number: 1 }], error: null });
    await callNext('salon-1');
    expect(rpc).toHaveBeenCalledWith('barber_next', { p_salon_id: 'salon-1', p_lane_id: null });
  });

  it('addWalkIn(salonId) calls add_walk_in for that salon, on the default line', async () => {
    rpc.mockResolvedValue({ data: [{ entry_id: 'w1', token_number: 4 }], error: null });
    const r = await addWalkIn('salon-1');
    expect(rpc).toHaveBeenCalledWith('add_walk_in', { p_salon_id: 'salon-1', p_lane_id: null });
    expect(r).toEqual({ id: 'w1', tokenNumber: 4, laneName: null });
  });

  it('getBarberQueueSnapshot(salonId) still works and shows the whole queue', async () => {
    const snap = await getBarberQueueSnapshot('salon-1');
    expect(snap.salonId).toBe('salon-1');
    expect(snap.lane).toBeNull();
    expect(snap.lanes).toBeNull();
  });

  it('with several barbers, a scope sends that barber\'s line', async () => {
    rpc.mockResolvedValue({ data: [{ called_entry_id: 'e1', called_token_number: 1 }], error: null });
    const scope = {
      salonId: 'salon-1', staffId: 's', isOwner: false, multi: true, laneId: 'lane-9', laneName: 'Rahul',
      laneIsPaused: false, ownLaneId: 'lane-9', lanes: [], entryLaneId: 'lane-9',
    };
    await callNext(scope);
    expect(rpc).toHaveBeenCalledWith('barber_next', { p_salon_id: 'salon-1', p_lane_id: 'lane-9' });
    rpc.mockResolvedValue({ data: [{ entry_id: 'w1', token_number: 5 }], error: null });
    const r = await addWalkIn(scope);
    expect(rpc).toHaveBeenLastCalledWith('add_walk_in', { p_salon_id: 'salon-1', p_lane_id: 'lane-9' });
    expect(r.laneName).toBe('Rahul');
  });
});
