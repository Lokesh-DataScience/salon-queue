// frontend/src/pages/BarberSettings.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberSettings from './BarberSettings';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';
import * as admin from '../api/admin';
import * as flags from '../api/flags';

vi.mock('../api/barber', () => ({
  logoutBarber: vi.fn(),
  fetchMe: vi.fn(),
}));
vi.mock('../api/admin', () => ({ fetchAdminMe: vi.fn() }));
vi.mock('../lib/multiBarber', () => ({ MULTI_BARBER: false }));
vi.mock('../api/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/flags')>()),
  fetchBarberFlags: vi.fn(),
}));

const OWNER = { id: 'staff-1', name: 'Owner', role: 'OWNER' as const, salonId: 'salon-1', laneId: null, laneName: null };

const renderSettings = () => renderPage(<BarberSettings />, { path: '/barber/settings', route: '/barber/settings' });

beforeEach(() => {
  vi.mocked(barber.logoutBarber).mockReset();
  vi.mocked(barber.fetchMe).mockReset().mockResolvedValue(OWNER);
  vi.mocked(admin.fetchAdminMe).mockReset().mockResolvedValue(null); // a normal barber
  vi.mocked(flags.fetchBarberFlags).mockReset().mockResolvedValue({});
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

  it('shows no Admin row to a normal barber', async () => {
    renderSettings();
    await screen.findByRole('link', { name: /salon qr code/i });
    expect(screen.queryByRole('link', { name: /^admin/i })).not.toBeInTheDocument();
  });

  it('shows the Admin row to an admin account', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'SALES', sections: ['sales'] });
    renderSettings();
    expect(await screen.findByRole('link', { name: /^admin/i })).toHaveAttribute('href', '/barber/admin');
  });

  it('logs out from Settings and leaves for the login page', async () => {
    vi.mocked(barber.logoutBarber).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(barber.logoutBarber).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
  });

  it('shows "Report a problem" unless the bug_reports flag is off', async () => {
    renderSettings();
    expect(await screen.findByRole('link', { name: /report a problem/i })).toHaveAttribute('href', '/barber/report');
  });

  it('hides "Report a problem" when Tech switches the flag off', async () => {
    vi.mocked(flags.fetchBarberFlags).mockResolvedValue({ bug_reports: { enabled: false, value: '' } });
    renderSettings();
    await screen.findByRole('link', { name: /salon profile/i });
    await vi.waitFor(() => expect(screen.queryByRole('link', { name: /report a problem/i })).not.toBeInTheDocument());
  });
});
