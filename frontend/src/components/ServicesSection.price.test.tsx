// Barber Settings → Services: the optional price field (customer app polish, slice 2).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ServicesSection from './ServicesSection';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';

vi.mock('../api/barber', () => ({
  fetchServices: vi.fn(),
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
}));

const renderSection = () => renderPage(<ServicesSection />, { path: '/barber/settings/services', route: '/barber/settings/services' });

beforeEach(() => {
  vi.mocked(barber.fetchServices).mockReset().mockResolvedValue([
    { id: 'a', name: 'Haircut', durationMinutes: 20, priceRupees: 100 },
    { id: 'b', name: 'Shave', durationMinutes: 10, priceRupees: null },
  ]);
  vi.mocked(barber.createService).mockReset().mockImplementation(async (input) => ({ id: 'n', ...input }));
  vi.mocked(barber.updateService).mockReset().mockImplementation(async (id, changes) => ({
    id,
    name: 'Haircut',
    durationMinutes: 20,
    ...changes,
  }));
});

describe('ServicesSection prices', () => {
  it('shows a price next to the time only when one is set', async () => {
    renderSection();
    expect(await screen.findByText('20 min · ₹100')).toBeInTheDocument();
    expect(screen.getByText('10 min')).toBeInTheDocument();
  });

  it('adds a service with a price', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(await screen.findByLabelText('Service name'), 'Beard trim');
    await user.type(screen.getByLabelText('Time (minutes)'), '15');
    await user.type(screen.getByLabelText('Price ₹ (optional)'), '80');
    await user.click(screen.getByRole('button', { name: 'Add service' }));
    // TanStack passes the mutation context as a second argument, so check the first one only.
    expect(vi.mocked(barber.createService).mock.calls[0][0]).toEqual({ name: 'Beard trim', durationMinutes: 15, priceRupees: 80 });
  });

  it('adds a service without a price exactly as before (no price key sent)', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(await screen.findByLabelText('Service name'), 'Wash');
    await user.type(screen.getByLabelText('Time (minutes)'), '5');
    await user.click(screen.getByRole('button', { name: 'Add service' }));
    expect(vi.mocked(barber.createService).mock.calls[0][0]).toEqual({ name: 'Wash', durationMinutes: 5 });
  });

  it('the price box takes digits only', async () => {
    const user = userEvent.setup();
    renderSection();
    const price = await screen.findByLabelText('Price ₹ (optional)');
    await user.type(price, '₹1a2.5');
    expect(price).toHaveValue('125');
  });

  it('clearing the price on edit sends null, and only the price changes', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Edit Haircut' }));
    const row = screen.getByDisplayValue('Haircut').closest('li')!;
    await user.clear(within(row).getByLabelText('Price ₹ (optional)'));
    await user.click(within(row).getByRole('button', { name: 'Save' }));
    expect(barber.updateService).toHaveBeenCalledWith('a', { priceRupees: null });
  });

  it('setting a price on a service that had none sends just the price', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Edit Shave' }));
    const row = screen.getByDisplayValue('Shave').closest('li')!;
    await user.type(within(row).getByLabelText('Price ₹ (optional)'), '50');
    await user.click(within(row).getByRole('button', { name: 'Save' }));
    expect(barber.updateService).toHaveBeenCalledWith('b', { priceRupees: 50 });
  });
});
