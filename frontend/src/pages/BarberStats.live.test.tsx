// frontend/src/pages/BarberStats.live.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BarberStats from './BarberStats';
import * as barber from '../api/barber';
import type { BarberStats as Stats } from '../api/barber';

vi.mock('../api/barber', () => ({ fetchBarberStats: vi.fn() }));

const handlers = new Map<string, Set<() => void>>();
const emit = vi.fn();
vi.mock('../lib/socket', () => ({
  socket: {
    emit: (...a: unknown[]) => emit(...a),
    on: (ev: string, fn: () => void) => {
      handlers.set(ev, (handlers.get(ev) ?? new Set()).add(fn));
    },
    off: (ev: string, fn: () => void) => {
      handlers.get(ev)?.delete(fn);
    },
  },
}));

const day = (date: string) => ({ date, count: 0 });
const STATS = (served: number): Stats => ({
  today: '2026-11-09',
  servedToday: served,
  walkInToday: 0,
  qrToday: served,
  servedYesterday: 0,
  week: { start: '2026-11-09', total: served, walkIn: 0, qr: served, prevSamePeriod: 0, days: [day('2026-11-09')] },
  month: { start: '2026-11-01', total: served, walkIn: 0, qr: served, prevSamePeriod: 0, days: [day('2026-11-09')] },
});

function renderStats(withMe: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (withMe) {
    client.setQueryData(['barberMe'], {
      id: 's1', name: 'Owner', role: 'OWNER', salonId: 'salon-1', laneId: null, laneName: null,
    });
  }
  return render(
    <QueryClientProvider client={client}>
      <BarberStats />
    </QueryClientProvider>,
  );
}

const fire = () => act(() => handlers.get('queue:updated')?.forEach((fn) => fn()));

beforeEach(() => {
  handlers.clear();
  emit.mockReset();
  vi.mocked(barber.fetchBarberStats).mockReset().mockResolvedValue(STATS(1));
});

describe('BarberStats live updates', () => {
  it('joins the salon room, and a barber finishing a customer updates the number without a refresh', async () => {
    renderStats(true);
    expect(await screen.findByTestId('served-total')).toHaveTextContent('1');
    expect(emit).toHaveBeenCalledWith('join:salon', { salonId: 'salon-1' });

    vi.mocked(barber.fetchBarberStats).mockResolvedValue(STATS(2));
    fire();
    await waitFor(() => expect(screen.getByTestId('served-total')).toHaveTextContent('2'), { timeout: 4000 });
  });

  it('a burst of updates causes one refetch, not one per update', async () => {
    renderStats(true);
    await screen.findByTestId('served-total');
    expect(barber.fetchBarberStats).toHaveBeenCalledTimes(1);

    fire();
    fire();
    fire();
    await waitFor(() => expect(barber.fetchBarberStats).toHaveBeenCalledTimes(2), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(barber.fetchBarberStats).toHaveBeenCalledTimes(2);
  });

  it('stops listening and leaves the room when the page closes', async () => {
    const { unmount } = renderStats(true);
    await screen.findByTestId('served-total');
    expect(handlers.get('queue:updated')?.size).toBe(1);

    unmount();
    expect(handlers.get('queue:updated')?.size).toBe(0);
    expect(emit).toHaveBeenCalledWith('leave:salon', { salonId: 'salon-1' });
  });

  it('without the signed-in person loaded it simply does not subscribe, and still shows the numbers', async () => {
    renderStats(false);
    expect(await screen.findByTestId('served-total')).toHaveTextContent('1');
    expect(emit).not.toHaveBeenCalled();
  });
});
