// frontend/src/pages/BarberDashboard.services.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberDashboard from './BarberDashboard';
import { renderPage } from '../test/utils';
import { resetSocket } from '../test/fakeSocket';
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
  claimEntry: vi.fn(),
}));

const entry = (
  token: number,
  status: BarberQueueEntry['status'] = 'WAITING',
  extra: Partial<BarberQueueEntry> = {},
): BarberQueueEntry => ({
  id: `entry-${token}`,
  token_number: token,
  status,
  joined_at: '2026-01-01T00:00:00Z',
  called_at: null,
  started_at: null,
  completed_at: null,
  skipped_at: null,
  services: [],
  ...extra,
});

const prize = (over: Partial<NonNullable<BarberQueueEntry['prize']>> = {}) => ({
  name: 'Head massage',
  code: 'ABC234',
  redeemed: false,
  ...over,
});

const snapshot = (overrides: Partial<BarberQueueSnapshot> = {}): BarberQueueSnapshot => ({
  salonId: 'salon-1',
  queueStatus: 'ACTIVE',
  currentToken: 3,
  called: null,
  serving: null,
  waiting: [],
  ...overrides,
});

const given = (overrides: Partial<BarberQueueSnapshot> = {}) =>
  vi.mocked(barber.fetchBarberQueue).mockResolvedValue(snapshot(overrides));
const renderDashboard = () =>
  renderPage(<BarberDashboard />, { path: '/barber/dashboard', route: '/barber/dashboard' });

beforeEach(() => {
  resetSocket();
  Object.values(barber).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
});

describe('BarberDashboard: waiting rows', () => {
  it('shows the token and the chosen services on one line; no services means just the token', async () => {
    given({
      waiting: [entry(4, 'WAITING', { services: ['hair cutting', 'beard trimming'] }), entry(5)],
    });
    renderDashboard();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('#4');
    expect(rows[0]).toHaveTextContent('| hair cutting | beard trimming');
    expect(rows[1].textContent).toBe('#5');
  });

  it('never shows an offer, a code or a claim button for waiting customers', async () => {
    given({ waiting: [entry(4, 'WAITING', { services: ['hair cutting'] })] });
    renderDashboard();

    await screen.findByText('Waiting (1)');
    expect(screen.queryByRole('button', { name: 'Tap to claim' })).not.toBeInTheDocument();
    expect(screen.queryByText(/offer won/i)).not.toBeInTheDocument();
  });

  it('the Redeem box is gone', async () => {
    given();
    renderDashboard();

    await screen.findByText('Waiting (0)');
    expect(screen.queryByLabelText(/reward code/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redeem' })).not.toBeInTheDocument();
  });
});

describe('BarberDashboard: current customer card', () => {
  it('shows every service the customer chose', async () => {
    given({ serving: entry(4, 'SERVING', { services: ['beard trimming', 'hair cutting'] }) });
    renderDashboard();

    const list = await screen.findByRole('list', { name: 'Services chosen' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'beard trimming',
      'hair cutting',
    ]);
  });

  it('shows no offer panel when the customer won nothing', async () => {
    given({ serving: entry(4, 'SERVING', { prize: null }) });
    renderDashboard();

    await screen.findByRole('button', { name: 'COMPLETE #4' });
    expect(screen.queryByText(/offer won/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tap to claim' })).not.toBeInTheDocument();
  });

  it('a serving winner: shows the offer and its code, and one tap claims it', async () => {
    let claimed = false;
    vi.mocked(barber.fetchBarberQueue).mockImplementation(async () =>
      snapshot({ serving: entry(4, 'SERVING', { prize: prize({ redeemed: claimed }) }) }),
    );
    vi.mocked(barber.claimEntry).mockImplementation(async () => {
      claimed = true;
      return { prizeName: 'Head massage' };
    });
    const user = userEvent.setup();
    renderDashboard();

    expect(await screen.findByText('Head massage')).toBeInTheDocument();
    expect(screen.getByText('ABC234')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tap to claim' }));
    expect(barber.claimEntry).toHaveBeenCalledWith('entry-4');
    expect(await screen.findByText('Claimed ✓')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tap to claim' })).not.toBeInTheDocument();
  });

  it('a called winner (not started yet) can be claimed too', async () => {
    given({ called: entry(4, 'CALLED', { prize: prize() }) });
    renderDashboard();

    expect(await screen.findByRole('button', { name: 'Tap to claim' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'START #4' })).toBeInTheDocument();
  });

  it('an already claimed offer shows Claimed and no button', async () => {
    given({ serving: entry(4, 'SERVING', { prize: prize({ redeemed: true }) }) });
    renderDashboard();

    expect(await screen.findByText('Claimed ✓')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tap to claim' })).not.toBeInTheDocument();
  });

  it('a double tap sends one claim', async () => {
    given({ serving: entry(4, 'SERVING', { prize: prize() }) });
    let release!: () => void;
    vi.mocked(barber.claimEntry).mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ prizeName: 'Head massage' }); }),
    );
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'Tap to claim' }));
    const pending = await screen.findByRole('button', { name: 'Claiming...' });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(barber.claimEntry).toHaveBeenCalledTimes(1);

    await act(async () => release());
  });

  it("shows the server's reason when a claim is refused, and stays usable", async () => {
    given({ serving: entry(4, 'SERVING', { prize: prize() }) });
    vi.mocked(barber.claimEntry).mockRejectedValue(new Error('This offer was already claimed.'));
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'Tap to claim' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already claimed');
    expect(screen.getByRole('button', { name: 'COMPLETE #4' })).toBeEnabled();
  });
});