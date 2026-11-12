// frontend/src/pages/BarberAdmin.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberAdmin from './BarberAdmin';
import { renderPage } from '../test/utils';
import * as admin from '../api/admin';

vi.mock('../api/admin', () => ({
  fetchAdminMe: vi.fn(),
  fetchAdminSection: vi.fn(),
  fetchFounderOverview: vi.fn(),
  fetchAdminSalons: vi.fn(),
  fetchAdminSalon: vi.fn(),
  createAdminSalon: vi.fn(),
  setSalonSuspended: vi.fn(),
  setSalonInternal: vi.fn(),
  resetStaffPassword: vi.fn(),
  deleteAdminSalon: vi.fn(),
  fetchSalesActivity: vi.fn(),
  updateSalesInfo: vi.fn(),
  fetchTechHealth: vi.fn(),
}));

const renderAdmin = () => renderPage(<BarberAdmin />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchAdminMe).mockReset();
  vi.mocked(admin.fetchAdminSection)
    .mockReset()
    .mockImplementation(async (section) => ({ section, ok: true }));
  vi.mocked(admin.fetchFounderOverview).mockReset().mockResolvedValue({
    today: '2026-11-12',
    weekStart: '2026-11-09',
    monthStart: '2026-11-01',
    salons: { total: 0, newThisMonth: 0, active7d: 0 },
    periods: {
      today: { tickets: 0, walkIn: 0, qr: 0, served: 0, ticketsYesterday: 0 },
      week: { tickets: 0, walkIn: 0, qr: 0, served: 0 },
      month: { tickets: 0, walkIn: 0, qr: 0, served: 0 },
    },
    days: [],
  });
  vi.mocked(admin.fetchSalesActivity).mockReset().mockResolvedValue({ today: '2026-11-12', salons: [], areas: [] });
  vi.mocked(admin.fetchTechHealth).mockReset().mockRejectedValue(new Error('not needed in these tests'));
});

describe('BarberAdmin', () => {
  it('looks like a missing page to a normal barber', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue(null);
    renderAdmin();
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(admin.fetchAdminSection).not.toHaveBeenCalled();
  });

  it('shows SALES only the Sales section, with no tabs', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'SALES', sections: ['sales'] });
    renderAdmin();
    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByText(/founder/i)).not.toBeInTheDocument();
    expect(admin.fetchSalesActivity).toHaveBeenCalled();
  });

  it('gives FOUNDER three tabs and switches between them', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'FOUNDER', sections: ['founder', 'sales', 'tech'] });
    const user = userEvent.setup();
    renderAdmin();

    expect(await screen.findByRole('tab', { name: 'Founder' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Tech' }));
    expect(screen.getByRole('tab', { name: 'Tech' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Tech' })).toBeInTheDocument();
    expect(admin.fetchTechHealth).toHaveBeenCalled();
  });

  it('links back to Settings', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'TECH', sections: ['tech'] });
    renderAdmin();
    expect(await screen.findByRole('link', { name: /settings/i })).toHaveAttribute('href', '/barber/settings');
  });
});
