// frontend/src/components/BarberLayout.notice.test.tsx — Admin Slice 11: the barber_notice flag
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import BarberLayout from './BarberLayout';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';
import * as flags from '../api/flags';

vi.mock('../api/barber', () => ({ fetchMe: vi.fn(), logoutBarber: vi.fn() }));
vi.mock('../api/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/flags')>()),
  fetchBarberFlags: vi.fn(),
}));

const OWNER = { id: 'staff-1', name: 'Owner', role: 'OWNER' as const, salonId: 'salon-1', laneId: null, laneName: null };
const renderLayout = () => renderPage(<BarberLayout />, { path: '/barber/dashboard', route: '/barber/dashboard' });

beforeEach(() => {
  vi.mocked(barber.fetchMe).mockReset().mockResolvedValue(OWNER);
});

describe('Barber notice', () => {
  it('shows the notice text when the flag is on', async () => {
    vi.mocked(flags.fetchBarberFlags).mockReset().mockResolvedValue({
      barber_notice: { enabled: true, value: 'Maintenance tonight 11 pm' },
    });
    renderLayout();
    expect(await screen.findByText('Maintenance tonight 11 pm')).toBeInTheDocument();
  });

  it('shows nothing when the flag is off, even with text saved', async () => {
    vi.mocked(flags.fetchBarberFlags).mockReset().mockResolvedValue({
      barber_notice: { enabled: false, value: 'Old notice' },
    });
    renderLayout();
    await screen.findByRole('navigation', { name: 'Main' });
    await vi.waitFor(() => expect(flags.fetchBarberFlags).toHaveBeenCalled());
    expect(screen.queryByText('Old notice')).not.toBeInTheDocument();
  });
});
