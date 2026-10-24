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
  name: string,
  status: BarberQueueEntry['status'] = 'WAITING',
): BarberQueueEntry => ({
  id: `entry-${token}`,
  token_number: token,
  customer_name: name,
  customer_phone: '9876543210',
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
  waiting: [entry(4, 'Ravi'), entry(5, 'Meena')],
  ...overrides,
});

const given = (overrides: Partial<BarberQueueSnapshot> = {}) =>
  vi.mocked(barber.fetchBarberQueue).mockResolvedValue(snapshot(overrides));
const renderDashboard = () => renderPage(<BarberDashboard />, { path: '/barber/dashboard', route: '/barber/dashboard' });
const callNextButton = () => screen.getByRole('button', { name: /call next customer/i });

beforeEach(() => {
  resetSocket();
  Object.values(barber).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
});

describe('BarberDashboard', () => {
  it('lists the waiting customers and joins the salon room', async () => {
    given();
    renderDashboard();

    expect(await screen.findByText('Waiting (2)')).toBeInTheDocument();
    expect(screen.getByText('Ravi')).toBeInTheDocument();
    expect(screen.getByText('Meena')).toBeInTheDocument();
    await waitFor(() => expect(socket.emit).toHaveBeenCalledWith('join:salon', { salonId: 'salon-1' }));
  });

  it('calls the next customer', async () => {
    given();
    vi.mocked(barber.callNextCustomer).mockResolvedValue({ result: {} });
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('Waiting (2)');
    await user.click(callNextButton());
    expect(barber.callNextCustomer).toHaveBeenCalledTimes(1);
  });

  it('disables Call Next and explains why while someone is called', async () => {
    given({ called: entry(4, 'Ravi', 'CALLED'), waiting: [entry(5, 'Meena')] });
    renderDashboard();

    await screen.findByText('Called — Next Up');
    expect(callNextButton()).toBeDisabled();
    expect(screen.getByText('Start or skip the called customer first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Service' })).toBeEnabled();
  });

  it('shows RESUME and disables Call Next while paused', async () => {
    given({ queueStatus: 'PAUSED' });
    renderDashboard();

    expect(await screen.findByRole('button', { name: 'RESUME QUEUE' })).toBeInTheDocument();
    expect(callNextButton()).toBeDisabled();
    expect(screen.getByText('Resume the queue to call the next customer.')).toBeInTheDocument();
  });

  it('skips a specific waiting customer', async () => {
    given();
    vi.mocked(barber.skipEntry).mockResolvedValue({ entry: { id: 'entry-4', status: 'SKIPPED' } });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'Skip token 4' }));
    expect(barber.skipEntry).toHaveBeenCalledWith('entry-4');
  });

  it('announces a failed action', async () => {
    given();
    vi.mocked(barber.callNextCustomer).mockRejectedValue(new Error('A customer is already being called.'));
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('Waiting (2)');
    await user.click(callNextButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('A customer is already being called.');
  });

  it('sends the barber to login when the session has expired', async () => {
    given();
    renderDashboard();
    await screen.findByText('Waiting (2)');

    act(() => {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    });

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(screen.queryByText('Ravi')).not.toBeInTheDocument(); // customer names gone from the screen
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