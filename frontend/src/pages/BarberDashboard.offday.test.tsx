// @vitest-environment jsdom
// frontend/src/pages/BarberDashboard.offday.test.tsx — Weekly off day, Slice 2: the dashboard banner.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BarberDashboard from './BarberDashboard';

vi.mock('../lib/socket', () => ({ socket: { emit: () => {}, on: () => {}, off: () => {} } }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const QUEUE = {
  salonId: 's', queueStatus: 'ACTIVE', currentToken: 0, called: null, serving: null, waiting: [],
};

function mockServer(opts: { role: 'OWNER' | 'BARBER'; publicView: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    if (url.includes('/api/barber/me')) return json({ staff: { id: 'x', name: 'N', role: opts.role, salonId: 's', laneId: null, laneName: null } });
    if (url.includes('/api/salons/s/queue-public')) return json({ salon: opts.publicView });
    if (url.includes('/api/barber/queue')) return json(QUEUE);
    return json({ message: 'not found' }, 404);
  }));
}

const view = (over: Record<string, unknown>) => ({
  salonId: 's', name: 'Test', isOpen: true, isPaused: false, allowAppJoin: true, nowServingToken: 0,
  waitingCount: 0, estimatedWaitMinutes: null, lanes: null, isOffDay: false, weeklyOffDays: [], ...over,
});

function renderDash() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><BarberDashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('BarberDashboard weekly off banner', () => {
  it('the owner sees the banner on the off day, and +1 walk-in stays available', async () => {
    mockServer({ role: 'OWNER', publicView: view({ isOpen: false, isOffDay: true, weeklyOffDays: [2] }) });
    renderDash();
    expect(await screen.findByText('Today is your weekly off.')).toBeTruthy();
    expect((screen.getByRole('button', { name: '+1 Add walk-in' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('staff see it too', async () => {
    mockServer({ role: 'BARBER', publicView: view({ isOpen: false, isOffDay: true, weeklyOffDays: [2] }) });
    renderDash();
    expect(await screen.findByText('Today is your weekly off.')).toBeTruthy();
  });

  it('no banner on a normal day', async () => {
    mockServer({ role: 'OWNER', publicView: view({ weeklyOffDays: [2] }) });
    renderDash();
    await screen.findByRole('heading', { name: 'Salon queue' });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('/queue-public'))).toBe(true));
    expect(screen.queryByText('Today is your weekly off.')).toBeNull();
  });
});
