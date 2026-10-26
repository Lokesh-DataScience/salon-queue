// frontend/src/pages/BarberDashboard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberDashboard from './BarberDashboard';
import { renderPage } from '../test/utils';
import { socket, resetSocket } from '../test/fakeSocket';
import { SESSION_EXPIRED_EVENT } from '../api/client';
import * as barber from '../api/barber';
import type { BarberQueueEntry, BarberQueueSnapshot } from '../api/barber';

vi.mock('../lib/socket', () => import('../test/fakeSocket'));
vi.mock('../api/barber', () => ({
  fetchBarberQueue: vi.fn(),
  callNextCustomer: vi.fn(),
  startEntry: vi.fn(),
  completeEntry: vi.fn(),
  skipEntry: vi.fn(),
  pauseQueue: vi.fn(),
  resumeQueue: vi.fn(),
  logoutBarber: vi.fn(),
}));

const entry = (
  token: number,
  status: BarberQueueEntry['status'] = 'WAITING',
): BarberQueueEntry => ({
  id: `entry-${token}`,
  token_number: token,
  status,
  joined_at: '2026-01-01T00:00:00Z',
  called_at: null,
  started_at: null,
  completed_at: null,
  skipped_at: null,
});

const snapshot = (overrides: Partial<BarberQueueSnapshot> = {}): BarberQueueSnapshot => ({
  salonId: 'salon-1',
  queueStatus: 'ACTIVE',
  currentToken: 3,
  called: null,
  serving: null,
  waiting: [entry(4), entry(5)],
  ...overrides,
});

const given = (overrides: Partial<BarberQueueSnapshot> = {}) =>
  vi.mocked(barber.fetchBarberQueue).mockResolvedValue(snapshot(overrides));
const renderDashboard = () => renderPage(<BarberDashboard />, { path: '/barber/dashboard', route: '/barber/dashboard' });

beforeEach(() => {
  resetSocket();
  Object.values(barber).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
});

describe('BarberDashboard (one-button)', () => {
  it('lists waiting customers read-only and joins the salon room', async () => {
    given();
    renderDashboard();

    expect(await screen.findByText('Waiting (2)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip token/i })).not.toBeInTheDocument();
    await waitFor(() => expect(socket.emit).toHaveBeenCalledWith('join:salon', { salonId: 'salon-1' }));
  });

  it('idle: one tap calls the next customer and starts them', async () => {
    given();
    vi.mocked(barber.callNextCustomer).mockResolvedValue({
      result: { called_entry_id: 'entry-4', called_token_number: 4 },
    });
    vi.mocked(barber.startEntry).mockResolvedValue({ entry: { id: 'entry-4', status: 'SERVING' } });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'START NEXT #4' }));
    expect(barber.callNextCustomer).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(barber.startEntry).toHaveBeenCalledWith('entry-4'));
  });

  it('idle: if start fails after the call, shows the error and does not complete anyone', async () => {
    given();
    vi.mocked(barber.callNextCustomer).mockResolvedValue({ result: { called_entry_id: 'entry-4' } });
    vi.mocked(barber.startEntry).mockRejectedValue(new Error('Could not start.'));
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'START NEXT #4' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start.');
    expect(barber.completeEntry).not.toHaveBeenCalled();
  });

  it('called: the button becomes START and starts that customer', async () => {
    given({ called: entry(4, 'CALLED'), waiting: [entry(5)] });
    vi.mocked(barber.startEntry).mockResolvedValue({ entry: { id: 'entry-4', status: 'SERVING' } });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'START #4' }));
    expect(barber.startEntry).toHaveBeenCalledWith('entry-4');
    expect(barber.callNextCustomer).not.toHaveBeenCalled();
  });

  it('serving: the button becomes COMPLETE and completes that customer', async () => {
    given({ serving: entry(4, 'SERVING'), waiting: [entry(5)] });
    vi.mocked(barber.completeEntry).mockResolvedValue({ entry: { id: 'entry-4', status: 'COMPLETED' } });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'COMPLETE #4' }));
    expect(barber.completeEntry).toHaveBeenCalledWith('entry-4');
    expect(barber.callNextCustomer).not.toHaveBeenCalled();
  });

  it('paused and idle: the one button resumes the queue', async () => {
    given({ queueStatus: 'PAUSED' });
    vi.mocked(barber.resumeQueue).mockResolvedValue({ queue: { status: 'ACTIVE' } });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'RESUME QUEUE' }));
    expect(barber.resumeQueue).toHaveBeenCalledTimes(1);
    expect(barber.callNextCustomer).not.toHaveBeenCalled();
  });

  it('empty queue: the button is disabled', async () => {
    given({ waiting: [] });
    renderDashboard();

    expect(await screen.findByRole('button', { name: 'NO ONE WAITING' })).toBeDisabled();
  });

  it('keeps skip and pause under "More actions"', async () => {
    given({ called: entry(4, 'CALLED'), waiting: [entry(5)] });
    vi.mocked(barber.skipEntry).mockResolvedValue({ entry: { id: 'entry-4', status: 'SKIPPED' } });
    vi.mocked(barber.pauseQueue).mockResolvedValue({ queue: { status: 'PAUSED' } });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByText('More actions'));
    await user.click(screen.getByRole('button', { name: 'Skip #4' }));
    expect(barber.skipEntry).toHaveBeenCalledWith('entry-4');
    await user.click(screen.getByRole('button', { name: 'Pause queue' }));
    expect(barber.pauseQueue).toHaveBeenCalledTimes(1);
  });

  it('sends the barber to login when the session has expired', async () => {
    given();
    renderDashboard();
    await screen.findByText('Waiting (2)');

    act(() => {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    });

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(screen.queryByText('Waiting (2)')).not.toBeInTheDocument();
  });

  it('logs out and leaves the dashboard', async () => {
    given();
    vi.mocked(barber.logoutBarber).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(barber.logoutBarber).toHaveBeenCalled();
    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
  });
});