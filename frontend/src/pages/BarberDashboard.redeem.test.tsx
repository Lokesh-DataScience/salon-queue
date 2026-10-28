// frontend/src/pages/BarberDashboard.redeem.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberDashboard from './BarberDashboard';
import { renderPage } from '../test/utils';
import { resetSocket } from '../test/fakeSocket';
import * as barber from '../api/barber';
import * as offers from '../api/offers';

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
  logoutBarber: vi.fn(),
}));
vi.mock('../api/offers', () => ({ redeemCode: vi.fn() }));

beforeEach(() => {
  resetSocket();
  vi.mocked(barber.fetchBarberQueue).mockReset().mockResolvedValue({
    salonId: 'salon-1',
    queueStatus: 'ACTIVE',
    currentToken: 0,
    called: null,
    serving: null,
    waiting: [],
  });
  vi.mocked(offers.redeemCode).mockReset();
});

const renderDashboard = () =>
  renderPage(<BarberDashboard />, { path: '/barber/dashboard', route: '/barber/dashboard' });

describe('BarberDashboard: redeem a reward code', () => {
  it('keeps Redeem disabled until the code is 6 characters', async () => {
    const user = userEvent.setup();
    renderDashboard();

    const input = await screen.findByLabelText(/reward code/i);
    const button = screen.getByRole('button', { name: 'Redeem' });
    expect(button).toBeDisabled();
    await user.type(input, 'abc23');
    expect(button).toBeDisabled();
    await user.type(input, '4');
    expect(button).toBeEnabled();
  });

  it('redeems a code, shows the prize and clears the box', async () => {
    vi.mocked(offers.redeemCode).mockResolvedValue({ prizeName: 'Head massage' });
    const user = userEvent.setup();
    renderDashboard();

    const input = await screen.findByLabelText(/reward code/i);
    await user.type(input, 'abc234');
    await user.click(screen.getByRole('button', { name: 'Redeem' }));

    expect(offers.redeemCode).toHaveBeenCalledWith('abc234');
    expect(await screen.findByRole('status')).toHaveTextContent('Redeemed: Head massage');
    expect(input).toHaveValue('');
  });

  it("shows the server's reason when a code is refused", async () => {
    vi.mocked(offers.redeemCode).mockRejectedValue(new Error('This prize was already redeemed.'));
    const user = userEvent.setup();
    renderDashboard();

    await user.type(await screen.findByLabelText(/reward code/i), 'ABC234');
    await user.click(screen.getByRole('button', { name: 'Redeem' }));
    expect(await screen.findByText('This prize was already redeemed.')).toBeInTheDocument();
  });

  it('links to the Offers page', async () => {
    renderDashboard();
    expect(await screen.findByRole('link', { name: 'Offers' })).toHaveAttribute('href', '/barber/offers');
  });
});