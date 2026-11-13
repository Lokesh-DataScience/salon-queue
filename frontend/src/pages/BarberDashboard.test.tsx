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
  addWalkIn: vi.fn(),
  startEntry: vi.fn(),
  completeEntry: vi.fn(),
  skipEntry: vi.fn(),
  pauseQueue: vi.fn(),
  resumeQueue: vi.fn(),
  prioritizeEntry: vi.fn(),
  markNotHere: vi.fn(),
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
  priority_at: null,
  customer_name: null,
  customer_phone: null,
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

  it('keeps account links off the dashboard (they live in Settings)', async () => {
    given();
    renderDashboard();
    await screen.findByText('Waiting (2)');

    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Offers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Print salon QR' })).not.toBeInTheDocument();
  });
  it('+1 adds a walk-in and confirms the token number', async () => {
    given();
    vi.mocked(barber.addWalkIn).mockResolvedValue({ entry: { id: 'entry-6', tokenNumber: 6 } });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: /add walk-in/i }));
    expect(barber.addWalkIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Token #6 added/)).toBeInTheDocument();
  });

  it('+1 shows the server error and keeps the queue usable', async () => {
    given();
    vi.mocked(barber.addWalkIn).mockRejectedValue(new Error('The salon is closed right now, so no one can be added.'));
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: /add walk-in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('closed right now');
  });

  it('+1 is disabled while the queue is paused', async () => {
    given({ queueStatus: 'PAUSED' });
    renderDashboard();

    expect(await screen.findByRole('button', { name: /add walk-in/i })).toBeDisabled();
    expect(screen.getByText('Resume the queue to add a walk-in.')).toBeInTheDocument();
  });
  it('emergency: tapping a waiting token and confirming moves it to the front', async () => {
    given({ waiting: [entry(4), entry(5), entry(6)] });
    vi.mocked(barber.prioritizeEntry).mockResolvedValue({ entry: { id: 'entry-6', tokenNumber: 6 } });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'Serve #6 next' }));
    await user.click(screen.getByRole('button', { name: 'Yes, serve next' }));
    await waitFor(() => expect(barber.prioritizeEntry).toHaveBeenCalledWith('entry-6'));
  });

  it('emergency: cancelling the sheet does nothing', async () => {
    given({ waiting: [entry(4), entry(5)] });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'Serve #5 next' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(barber.prioritizeEntry).not.toHaveBeenCalled();
  });

  it('emergency: the next token and priority tokens cannot be tapped', async () => {
    given({ waiting: [{ ...entry(8), priority_at: '2026-01-01T00:00:01Z' }, entry(3), entry(4)] });
    renderDashboard();

    await screen.findByText('Waiting (3)');
    expect(screen.queryByRole('button', { name: 'Serve #8 next' })).not.toBeInTheDocument();
    expect(screen.getByText('⚡ Priority · Next')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Serve #3 next' })).toBeInTheDocument();
  });

  it('shows each waiting customer with a tap-to-call number, and "No details saved" for a walk-in', async () => {
    given({
      waiting: [
        { ...entry(4), customer_name: 'Ravi Kumar', customer_phone: '9876543210' },
        { ...entry(5), customer_name: 'Meena Iyer', customer_phone: '9123456780' },
        entry(6), // a walk-in has no saved details
      ],
    });
    renderDashboard();

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Meena Iyer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call 98765 43210' })).toHaveAttribute('href', 'tel:+919876543210');
    expect(screen.getByRole('link', { name: 'Call 91234 56780' })).toHaveAttribute('href', 'tel:+919123456780');
    expect(screen.getAllByText('No details saved')).toHaveLength(1);
    // The token buttons still work as before.
    expect(screen.getByRole('button', { name: 'Serve #5 next' })).toBeInTheDocument();
  });

  it('shows the name and call link of the customer being served', async () => {
    given({
      serving: { ...entry(4, 'SERVING'), customer_name: 'Asha Rao', customer_phone: '9988776655' },
      waiting: [],
    });
    renderDashboard();

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call 99887 76655' })).toHaveAttribute('href', 'tel:+919988776655');
  });

  // ── Customer app Slice 2: "Not here" ──
  const fromApp = (e: BarberQueueEntry, notHere = 0): BarberQueueEntry => ({ ...e, join_source: 'app', not_here_count: notHere });

  it('not here: an app customer at the chair can be moved back 2 places after confirming', async () => {
    given({ serving: fromApp(entry(4, 'SERVING')), waiting: [entry(5), entry(6)] });
    vi.mocked(barber.markNotHere).mockResolvedValue({ entry: { id: 'entry-4', action: 'moved_back', tokenNumber: 4 } });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'Not here — move #4 back 2' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Move #4 back 2 places?');
    expect(barber.markNotHere).not.toHaveBeenCalled(); // nothing happens before the confirm
    await user.click(screen.getByRole('button', { name: 'Yes, move back' }));
    await waitFor(() => expect(barber.markNotHere).toHaveBeenCalledWith('entry-4'));
  });

  it('not here: "Keep waiting" closes the sheet and changes nothing', async () => {
    given({ serving: fromApp(entry(4, 'SERVING')), waiting: [entry(5)] });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: /Not here/ }));
    await user.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(barber.markNotHere).not.toHaveBeenCalled();
  });

  it('not here: the second time, the button says it will cancel', async () => {
    given({ serving: fromApp(entry(4, 'SERVING'), 1), waiting: [entry(5)] });
    renderDashboard();
    expect(await screen.findByRole('button', { name: 'Not here — cancel #4' })).toBeInTheDocument();
  });

  it('not here: with nobody else waiting, the button says it will cancel', async () => {
    given({ serving: fromApp(entry(7, 'SERVING')), waiting: [] });
    const user = userEvent.setup();
    renderDashboard();
    await user.click(await screen.findByRole('button', { name: 'Not here — cancel #7' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Cancel token #7?');
  });

  it('not here: never offered for a customer who scanned the wall QR', async () => {
    given({ serving: entry(4, 'SERVING'), waiting: [entry(5)] });
    renderDashboard();
    await screen.findByRole('button', { name: 'COMPLETE #4' });
    expect(screen.queryByRole('button', { name: /Not here/ })).not.toBeInTheDocument();
    expect(screen.queryByText('📱 App')).not.toBeInTheDocument();
  });

  it('marks app customers with an App badge in the waiting list', async () => {
    given({ waiting: [entry(4), fromApp(entry(5))] });
    renderDashboard();
    await screen.findByText('Waiting (2)');
    expect(screen.getAllByText('📱 App')).toHaveLength(1);
  });

  it('not here: a server refusal is shown and the queue re-syncs', async () => {
    given({ serving: fromApp(entry(4, 'SERVING')), waiting: [entry(5)] });
    vi.mocked(barber.markNotHere).mockRejectedValue(new Error('This customer is no longer at the chair.'));
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: /Not here/ }));
    await user.click(screen.getByRole('button', { name: 'Yes, move back' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer at the chair');
  });
});
