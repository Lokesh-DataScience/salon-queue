// frontend/src/components/admin/FounderSalons.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FounderSalons from './FounderSalons';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { AdminSalonDetail, AdminSalonSummary } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  fetchAdminMe: vi.fn(),
  fetchAdminSalons: vi.fn(),
  fetchAdminSalon: vi.fn(),
  createAdminSalon: vi.fn(),
  setSalonSuspended: vi.fn(),
  setSalonInternal: vi.fn(),
  resetStaffPassword: vi.fn(),
  deleteAdminSalon: vi.fn(),
}));

const REAL: AdminSalonSummary = {
  id: 'salon-real',
  name: 'Milan Hair Salon',
  phone: '9876543210',
  address: 'Main Road, Korba',
  createdAt: '2026-10-24T06:00:00Z',
  isInternal: false,
  isSuspended: true,
  owner: { name: 'Milan', email: 'milan@example.com', phone: null },
  staffCount: 1,
};
const DEMO: AdminSalonSummary = { ...REAL, id: 'salon-demo', name: 'Demo Salon', isInternal: true, isSuspended: false };

const detail = (s: AdminSalonSummary): AdminSalonDetail => ({
  ...s,
  suspendedAt: null,
  staff: [{ id: 'staff-1', name: 'Milan', email: 'milan@example.com', phone: null, role: 'OWNER', isActive: true }],
});

const renderIt = () => renderPage(<FounderSalons />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchAdminMe).mockReset().mockResolvedValue({ role: 'FOUNDER', sections: ['founder', 'sales', 'tech'] });
  vi.mocked(admin.fetchAdminSalons).mockReset().mockResolvedValue([REAL, DEMO]);
  vi.mocked(admin.fetchAdminSalon).mockReset().mockImplementation(async (id) => detail(id === DEMO.id ? DEMO : { ...REAL, isSuspended: false }));
  vi.mocked(admin.setSalonSuspended).mockReset().mockResolvedValue({ salon: { id: REAL.id, isSuspended: true } });
  vi.mocked(admin.deleteAdminSalon).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(admin.resetStaffPassword).mockReset().mockResolvedValue({ ok: true });
});

describe('FounderSalons', () => {
  it('lists salons with text badges and searches', async () => {
    const user = userEvent.setup();
    renderIt();
    const list = await screen.findByRole('list', { name: 'Salons' });
    expect(within(list).getByText('Milan Hair Salon')).toBeInTheDocument();
    expect(within(list).getByText('Suspended')).toBeInTheDocument();
    expect(within(list).getByText('Internal')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search salons'), 'Milan');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(admin.fetchAdminSalons).toHaveBeenLastCalledWith('Milan');
  });

  it('opens a salon and suspends it only after a second, explicit tap', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: /milan hair salon/i }));
    expect(await screen.findByRole('heading', { name: 'Milan Hair Salon' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Suspend salon' }));
    expect(admin.setSalonSuspended).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, suspend Milan Hair Salon' }));
    expect(admin.setSalonSuspended).toHaveBeenCalledWith('salon-real', true);
  });

  it('offers delete only for internal salons, and only after the exact name is typed', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: /milan hair salon/i }));
    await screen.findByRole('heading', { name: 'Milan Hair Salon' });
    expect(screen.queryByRole('button', { name: /delete salon forever/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '‹ All salons' }));
    await user.click(await screen.findByRole('button', { name: /demo salon/i }));
    const del = await screen.findByRole('button', { name: /delete salon forever/i });
    expect(del).toBeDisabled();
    await user.type(screen.getByLabelText(/to confirm/i), 'Demo Salon');
    expect(del).toBeEnabled();
    await user.click(del);
    expect(admin.deleteAdminSalon).toHaveBeenCalledWith('salon-demo', 'Demo Salon');
  });

  it('resets a staff password with the founder password', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: /milan hair salon/i }));
    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    await user.type(screen.getByLabelText(/new password for milan/i), 'brand-new-pass');
    await user.type(screen.getByLabelText(/your password/i), 'founder-pass');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(admin.resetStaffPassword).toHaveBeenCalledWith('staff-1', 'founder-pass', 'brand-new-pass');
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
  });
});

describe('FounderSalons as Cofounder', () => {
  beforeEach(() => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'COFOUNDER', sections: ['founder', 'sales', 'tech'] });
  });

  it('shows the list but no Add a salon button', async () => {
    renderIt();
    await screen.findByRole('list', { name: 'Salons' });
    await vi.waitFor(() => expect(admin.fetchAdminMe).toHaveBeenCalled());
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Add a salon' })).not.toBeInTheDocument());
  });

  it('shows salon details and staff, with no buttons that change anything', async () => {
    renderPage(<FounderSalons />, { path: '/barber/admin', route: '/barber/admin?salon=salon-demo' });
    expect(await screen.findByText(/view only/i)).toBeInTheDocument();
    expect(screen.getByText('milan@example.com')).toBeInTheDocument();
    for (const name of [/reset password/i, /suspend salon/i, /mark as/i, /delete salon forever/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});
