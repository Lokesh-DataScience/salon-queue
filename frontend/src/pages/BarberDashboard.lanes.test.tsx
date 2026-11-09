// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BarberDashboard from './BarberDashboard';

vi.mock('../lib/socket', () => ({ socket: { emit: () => {}, on: () => {}, off: () => {} } }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const entry = (n: number, status = 'WAITING') => ({
  id: `e${n}`, token_number: n, status, joined_at: '', called_at: null, started_at: null,
  completed_at: null, skipped_at: null, priority_at: null,
});

const ONE_BARBER = {
  salonId: 's', queueStatus: 'ACTIVE', currentToken: 3, called: null, serving: entry(3, 'SERVING'),
  waiting: [entry(4)],
};
const RAHUL_LINE = {
  ...ONE_BARBER, currentToken: 7, lane: { id: 'lane-rahul', name: 'Rahul', isPaused: false }, lanes: null,
};
const OWNER_VIEW = {
  ...ONE_BARBER,
  lane: { id: 'lane-owner', name: 'Sunita', isPaused: false },
  lanes: [
    { id: 'lane-owner', name: 'Sunita', isMine: true, isPaused: false, waitingCount: 1, busy: true },
    { id: 'lane-rahul', name: 'Rahul', isMine: false, isPaused: false, waitingCount: 4, busy: true },
  ],
};

let calls: { method: string; url: string }[] = [];

function mockServer(opts: { queue: (url: string) => unknown; role: 'OWNER' | 'BARBER'; walkIn?: unknown; password?: Response }) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, ''); // the client sends full URLs; compare the path
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (url.includes('/api/barber/me/password')) return opts.password ?? json({ ok: true });
    if (url.includes('/api/barber/me')) return json({ staff: { id: 'x', name: 'N', role: opts.role, salonId: 's', laneId: 'l', laneName: 'L' } });
    if (url.includes('/queue/walk-in')) return json({ entry: opts.walkIn ?? { id: 'w', tokenNumber: 9 } }, 201);
    if (url.includes('/api/barber/queue')) return json(opts.queue(url));
    return json({ message: 'not found' }, 404);
  }));
}

function renderDash() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><BarberDashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('BarberDashboard with one barber (unchanged)', () => {
  it('looks and behaves exactly as before: no switcher, no line wording, plain requests', async () => {
    mockServer({ queue: () => ONE_BARBER, role: 'OWNER' });
    renderDash();
    expect(await screen.findByRole('heading', { name: 'Salon queue' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Barber lines' })).toBeNull();
    expect(screen.getByText('Queue active')).toBeTruthy();
    expect(screen.getByText('Pause queue')).toBeTruthy();
    expect(screen.queryByText('My account')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+1 Add walk-in' }));
    expect(await screen.findByText('Token #9 added to the queue.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')!.url).toBe('/api/barber/queue/walk-in');
    expect(calls.filter((c) => c.method === 'GET' && c.url.includes('/queue')).every((c) => !c.url.includes('laneId'))).toBe(true);
  });
});

describe('BarberDashboard for a barber on staff', () => {
  it("shows only their own line, with no switcher, and can change their password", async () => {
    mockServer({ queue: () => RAHUL_LINE, role: 'BARBER', walkIn: { id: 'w', tokenNumber: 9, laneName: 'Rahul' } });
    renderDash();
    expect(await screen.findByRole('heading', { name: "Rahul's line" })).toBeTruthy();
    expect(screen.getByText('Line active')).toBeTruthy();
    expect(screen.getByText('Current token #7')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Barber lines' })).toBeNull();
    expect(await screen.findByText('My account')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '+1 Add walk-in' }));
    expect(await screen.findByText("Token #9 added to Rahul's line.")).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')!.url).toBe('/api/barber/queue/walk-in'); // staff never name a line
  });

  it('shows the real reason when the current password is wrong', async () => {
    mockServer({ queue: () => RAHUL_LINE, role: 'BARBER', password: json({ message: 'Your current password is not correct.' }, 400) });
    renderDash();
    fireEvent.click(await screen.findByText('My account'));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpassword' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brandnew123' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'brandnew123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Your current password is not correct.'));
  });

  it('will not submit when the two new passwords differ', async () => {
    mockServer({ queue: () => RAHUL_LINE, role: 'BARBER' });
    renderDash();
    fireEvent.click(await screen.findByText('My account'));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpassword' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brandnew123' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'different999' } });
    expect(screen.getByText('The two new passwords are different.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a line on a break says so and offers to resume it', async () => {
    mockServer({
      queue: () => ({ ...RAHUL_LINE, queueStatus: 'PAUSED', serving: null, called: null, waiting: [], lane: { id: 'lane-rahul', name: 'Rahul', isPaused: true } }),
      role: 'BARBER',
    });
    renderDash();
    expect(await screen.findByText('Line paused')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'RESUME LINE' })).toBeTruthy();
  });
});

describe('BarberDashboard for the owner with several barbers', () => {
  it('shows a switcher, opens another barber\'s line, and sends walk-ins to that line', async () => {
    mockServer({
      queue: (url) => (url.includes('laneId=lane-rahul') ? { ...OWNER_VIEW, lane: { id: 'lane-rahul', name: 'Rahul', isPaused: false } } : OWNER_VIEW),
      role: 'OWNER',
      walkIn: { id: 'w', tokenNumber: 12, laneName: 'Rahul' },
    });
    renderDash();
    const group = await screen.findByRole('group', { name: 'Barber lines' });
    expect(group.textContent).toContain('Sunita (you)');
    expect(group.textContent).toContain('4 waiting');
    expect((screen.getByRole('button', { name: /Sunita/ }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Rahul/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/barber/queue?laneId=lane-rahul'))).toBe(true));
    await waitFor(() => expect((screen.getByRole('button', { name: /Rahul/ }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true'));
    expect(await screen.findByRole('heading', { name: "Rahul's line" })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '+1 Add walk-in' }));
    expect(await screen.findByText("Token #12 added to Rahul's line.")).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')!.url).toBe('/api/barber/queue/walk-in?laneId=lane-rahul');

    // going back to their own line stops sending a line id
    fireEvent.click(screen.getByRole('button', { name: /Sunita/ }));
    await waitFor(() => expect((screen.getByRole('button', { name: /Sunita/ }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true'));
  });
});
