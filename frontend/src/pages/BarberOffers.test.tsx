// frontend/src/pages/BarberOffers.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberOffers from './BarberOffers';
import { renderPage } from '../test/utils';
import * as offers from '../api/offers';
import type { Offer } from '../api/offers';

vi.mock('../api/offers', () => ({
  fetchOffers: vi.fn(),
  setExpectedCustomers: vi.fn(),
  createOffer: vi.fn(),
  updateOffer: vi.fn(),
  deleteOffer: vi.fn(),
  redeemCode: vi.fn(),
}));

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: 'o1',
  name: 'Head massage',
  dailyCount: 5,
  active: true,
  redeemedToday: 2,
  ...over,
});

const given = (list: Offer[] = [offer()], total = 2, expectedCustomers: number | null = null) =>
  vi.mocked(offers.fetchOffers).mockResolvedValue({
    offers: list,
    totalRedeemedToday: total,
    expectedCustomers,
  });
const renderOffers = () => renderPage(<BarberOffers />, { path: '/barber/offers', route: '/barber/offers' });

beforeEach(() => {
  Object.values(offers).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
});

describe('BarberOffers', () => {
  it('lists offers with the per-day count and redeemed-today totals', async () => {
    given([offer(), offer({ id: 'o2', name: 'Scrub', dailyCount: 2, redeemedToday: 0 })], 2);
    renderOffers();

    expect(await screen.findByText('Head massage')).toBeInTheDocument();
    expect(screen.getByText('Scrub')).toBeInTheDocument();
    expect(screen.getByText(/5 per day · redeemed today: 2/)).toBeInTheDocument();
    expect(screen.getByText('Redeemed today: 2')).toBeInTheDocument();
  });

  it('shows an empty state when there are no offers', async () => {
    given([], 0);
    renderOffers();
    expect(await screen.findByText(/no offers yet/i)).toBeInTheDocument();
  });

  it('validates the name and the count before calling the server', async () => {
    given([], 0);
    const user = userEvent.setup();
    renderOffers();
    await screen.findByText(/no offers yet/i);

    await user.type(screen.getByLabelText('Offer name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Add offer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/give the offer a name/i);

    await user.clear(screen.getByLabelText('Offer name'));
    await user.type(screen.getByLabelText('Offer name'), 'Scrub');
    await user.clear(screen.getByLabelText('How many per day'));
    await user.type(screen.getByLabelText('How many per day'), '0');
    await user.click(screen.getByRole('button', { name: 'Add offer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/1 to 50/);

    expect(offers.createOffer).not.toHaveBeenCalled();
  });

  it('adds an offer with a trimmed name and a numeric count, then reloads the list', async () => {
    given([], 0);
    vi.mocked(offers.createOffer).mockResolvedValue(offer());
    const user = userEvent.setup();
    renderOffers();
    await screen.findByText(/no offers yet/i);

    await user.type(screen.getByLabelText('Offer name'), '  Head massage ');
    await user.click(screen.getByRole('button', { name: 'Add offer' }));

    await waitFor(() =>
      expect(offers.createOffer).toHaveBeenCalledWith({ name: 'Head massage', dailyCount: 5 }),
    );
    await waitFor(() => expect(offers.fetchOffers).toHaveBeenCalledTimes(2));
  });

  it("shows the server's message when adding fails", async () => {
    given([], 0);
    vi.mocked(offers.createOffer).mockRejectedValue(new Error('You can have at most 10 offers.'));
    const user = userEvent.setup();
    renderOffers();
    await screen.findByText(/no offers yet/i);

    await user.type(screen.getByLabelText('Offer name'), 'Scrub');
    await user.click(screen.getByRole('button', { name: 'Add offer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You can have at most 10 offers.');
  });

  it('turns an offer off', async () => {
    given();
    vi.mocked(offers.updateOffer).mockResolvedValue(offer({ active: false }));
    const user = userEvent.setup();
    renderOffers();

    await user.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(offers.updateOffer).toHaveBeenCalledWith('o1', { active: false });
  });

  it('edits the per-day count', async () => {
    given();
    vi.mocked(offers.updateOffer).mockResolvedValue(offer({ dailyCount: 3 }));
    const user = userEvent.setup();
    renderOffers();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const input = screen.getByLabelText(/^per day$/i);
    await user.clear(input);
    await user.type(input, '3');
    const list = screen.getByRole('region', { name: 'Your offers' });
    await user.click(within(list).getByRole('button', { name: 'Save' }));
    expect(offers.updateOffer).toHaveBeenCalledWith('o1', { dailyCount: 3 });
    });

  it('asks for confirmation before deleting', async () => {
    given();
    vi.mocked(offers.deleteOffer).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderOffers();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(offers.deleteOffer).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(offers.deleteOffer).toHaveBeenCalledWith('o1');
  });
  it('shows the saved expected customers and saves a new number', async () => {
    vi.mocked(offers.fetchOffers).mockResolvedValue({ offers: [], totalRedeemedToday: 0, expectedCustomers: 20 });
    vi.mocked(offers.setExpectedCustomers).mockResolvedValue({ expectedCustomers: 30 });
    const user = userEvent.setup();
    renderOffers();

    const input = await screen.findByLabelText(/how many customers do you get/i);
    expect(input).toHaveValue('20');
    await user.clear(input);
    await user.type(input, '30');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(offers.setExpectedCustomers).toHaveBeenCalledWith(30);
    });

    it('an empty box clears the setting, and a bad number is refused before the server', async () => {
    vi.mocked(offers.fetchOffers).mockResolvedValue({ offers: [], totalRedeemedToday: 0, expectedCustomers: 20 });
    vi.mocked(offers.setExpectedCustomers).mockResolvedValue({ expectedCustomers: null });
    const user = userEvent.setup();
    renderOffers();

    const input = await screen.findByLabelText(/how many customers do you get/i);
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/1 to 500/);
    expect(offers.setExpectedCustomers).not.toHaveBeenCalled();

    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(offers.setExpectedCustomers).toHaveBeenCalledWith(null);
  });
});