// frontend/src/pages/BarberDashboard.redeem.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
  prioritizeEntry: vi.fn(),
  redeemPrizeForEntry: vi.fn(),
}));

const entry = (
  token: number,
  status: BarberQueueEntry['status'],
  prize: BarberQueueEntry['prize'] = null,
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
  prize,
});

const given = (over: Partial<BarberQueueSnapshot> = {}) =>
  vi.mocked(barber.fetchBarberQueue).mockResolvedValue({
    salonId: 'salon-1',
    queueStatus: 'ACTIVE',
    currentToken: 4,
    called: null,
    serving: null,
    waiting: [],
    ...over,
  });
const renderDashboard = () =>
  renderPage(<BarberDashboard />, { path: '/barber/dashboard', route: '/barber/dashboard' });

beforeEach(() => {
  resetSocket();
  Object.values(barber).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
});

describe('BarberDashboard: redeem a prize with one tap', () => {
  it('has no code box, and no button when the customer has no prize', async () => {
    given({ serving: entry(4, 'SERVING') });
    renderDashboard();

    await screen.findByRole('button', { name: 'COMPLETE #4' });
    expect(screen.queryByRole('button', { name: /redeem prize/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reward code/i)).not.toBeInTheDocument();
  });

  it('serving customer with a prize: one tap redeems it and shows it as given', async () => {
    given({ serving: entry(4, 'SERVING', { name: 'Head massage', redeemed: false }) });
    vi.mocked(barber.redeemPrizeForEntry).mockImplementation(async () => {
      given({ serving: entry(4, 'SERVING', { name: 'Head massage', redeemed: true }) }); // what the server would now say
      return { prizeName: 'Head massage' };
    });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: /redeem prize: head massage/i }));
    expect(barber.redeemPrizeForEntry).toHaveBeenCalledWith('entry-4');
    expect(await screen.findByText(/Head massage — given/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /redeem prize/i })).not.toBeInTheDocument());
  });

  it('an already redeemed prize shows as given and offers no button', async () => {
    given({ serving: entry(4, 'SERVING', { name: 'Scrub', redeemed: true }) });
    renderDashboard();

    expect(await screen.findByText(/Scrub — given/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /redeem prize/i })).not.toBeInTheDocument();
  });

  it('a called (not yet started) customer shows a hint, not the button', async () => {
    given({ called: entry(4, 'CALLED', { name: 'Scrub', redeemed: false }) });
    renderDashboard();

    expect(await screen.findByText(/once service starts/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /redeem prize/i })).not.toBeInTheDocument();
  });

  it("shows the server's reason when the redeem is refused", async () => {
    given({ serving: entry(4, 'SERVING', { name: 'Scrub', redeemed: false }) });
    vi.mocked(barber.redeemPrizeForEntry).mockRejectedValue(new Error('This prize was already redeemed.'));
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: /redeem prize/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This prize was already redeemed.');
  });
});