// frontend/src/pages/BarberSettings.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberSettings from './BarberSettings';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';

vi.mock('../api/barber', () => ({
  logoutBarber: vi.fn(),
  fetchMe: vi.fn(),
}));
vi.mock('../lib/multiBarber', () => ({ MULTI_BARBER: false }));

const OWNER = { id: 'staff-1', name: 'Owner', role: 'OWNER' as const, salonId: 'salon-1', laneId: null, laneName: null };

const renderSettings = () => renderPage(<BarberSettings />, { path: '/barber/settings', route: '/barber/settings' });

beforeEach(() => {
  vi.mocked(barber.logoutBarber).mockReset();
  vi.mocked(barber.fetchMe).mockReset().mockResolvedValue(OWNER);
});

describe('BarberSettings menu', () => {
  it('links to the profile and services pages', async () => {
    renderSettings();
    expect(await screen.findByRole('link', { name: /salon profile/i })).toHaveAttribute('href', '/barber/settings/profile');
    expect(screen.getByRole('link', { name: /^services/i })).toHaveAttribute('href', '/barber/settings/services');
  });

  it('hides the Barbers row while multi-barber is off', async () => {
    renderSettings();
    await screen.findByRole('link', { name: /salon profile/i });
    expect(screen.queryByRole('link', { name: /^barbers/i })).not.toBeInTheDocument();
  });

  it('links to the QR poster and the Offers page', async () => {
    renderSettings();
    expect(await screen.findByRole('link', { name: /salon qr code/i })).toHaveAttribute('href', '/barber/qr');
    expect(screen.getByRole('link', { name: /offers/i })).toHaveAttribute('href', '/barber/offers');
  });

  it('shows the Customers list link to the owner', async () => {
    renderSettings();
    expect(await screen.findByRole('link', { name: /^customers/i })).toHaveAttribute('href', '/barber/customers');
  });

  it('does not show the Customers link to a staff barber', async () => {
    vi.mocked(barber.fetchMe).mockResolvedValue({ ...OWNER, role: 'BARBER' });
    renderSettings();
    await screen.findByRole('link', { name: /salon qr code/i });
    expect(screen.queryByRole('link', { name: /^customers/i })).not.toBeInTheDocument();
  });

  it('logs out from Settings and leaves for the login page', async () => {
    vi.mocked(barber.logoutBarber).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(barber.logoutBarber).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
  });
});
