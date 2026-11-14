// frontend/src/pages/BarberSettings.offday.test.tsx — Weekly off day, Slice 2: the owner's day picker.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberSettings from './BarberSettings';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';
import * as admin from '../api/admin';
import * as flags from '../api/flags';

vi.mock('../api/barber', () => ({
  logoutBarber: vi.fn(),
  fetchMe: vi.fn(),
  fetchBarberSalonProfile: vi.fn(),
  updateBarberSalonProfile: vi.fn(),
}));
vi.mock('../api/admin', () => ({ fetchAdminMe: vi.fn() }));
vi.mock('../lib/multiBarber', () => ({ MULTI_BARBER: false }));
vi.mock('../api/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/flags')>()),
  fetchBarberFlags: vi.fn(),
}));

const OWNER = { id: 'staff-1', name: 'Owner', role: 'OWNER' as const, salonId: 'salon-1', laneId: null, laneName: null };
const PROFILE = {
  id: 'salon-1', name: 'Test Salon', qrCode: 'abc123abc123', phone: '9876543210', address: 'Main Road',
  openingTime: '09:00', closingTime: '21:00', averageServiceMinutes: 15, allowAppJoin: true, weeklyOffDays: [] as number[],
};

const renderSettings = () => renderPage(<BarberSettings />, { path: '/barber/settings', route: '/barber/settings' });
const days = () => within(screen.getByRole('group', { name: 'Weekly off days' }));

beforeEach(() => {
  vi.mocked(barber.fetchMe).mockReset().mockResolvedValue(OWNER);
  vi.mocked(admin.fetchAdminMe).mockReset().mockResolvedValue(null);
  vi.mocked(flags.fetchBarberFlags).mockReset().mockResolvedValue({});
  vi.mocked(barber.fetchBarberSalonProfile).mockReset().mockResolvedValue(PROFILE);
  vi.mocked(barber.updateBarberSalonProfile).mockReset();
});

describe('Weekly off day in Settings', () => {
  it('shows seven days, Monday first, none selected for a salon open every day', async () => {
    renderSettings();
    await screen.findByRole('group', { name: 'Weekly off days' });
    const buttons = days().getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
    buttons.forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByText(/Open every day/)).toBeInTheDocument();
  });

  it('tapping Tuesday saves it straight away and says what it means', async () => {
    vi.mocked(barber.updateBarberSalonProfile).mockResolvedValue({ ...PROFILE, weeklyOffDays: [2] });
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Tuesday' }));
    expect(barber.updateBarberSalonProfile).toHaveBeenCalledWith({ weeklyOffDays: [2] });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByText(/Closed every Tuesday\. Customers can't take a token that day\./)).toBeInTheDocument();
    expect(screen.getByText(/still add walk-ins with \+1/)).toBeInTheDocument();
  });

  it('adds a second day and removes one again, always sending the whole list', async () => {
    vi.mocked(barber.fetchBarberSalonProfile).mockResolvedValue({ ...PROFILE, weeklyOffDays: [2] });
    vi.mocked(barber.updateBarberSalonProfile)
      .mockResolvedValueOnce({ ...PROFILE, weeklyOffDays: [0, 2] })
      .mockResolvedValueOnce({ ...PROFILE, weeklyOffDays: [0] });
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Sunday' }));
    expect(barber.updateBarberSalonProfile).toHaveBeenLastCalledWith({ weeklyOffDays: [0, 2] });
    expect(await screen.findByText(/Closed every Tuesday and Sunday/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tuesday' }));
    expect(barber.updateBarberSalonProfile).toHaveBeenLastCalledWith({ weeklyOffDays: [0] });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'false'));
  });

  it('will not close all seven days', async () => {
    vi.mocked(barber.fetchBarberSalonProfile).mockResolvedValue({ ...PROFILE, weeklyOffDays: [0, 1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Saturday' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep at least one day open.');
    expect(barber.updateBarberSalonProfile).not.toHaveBeenCalled();
  });

  it('shows the error and keeps the saved days when saving fails', async () => {
    vi.mocked(barber.updateBarberSalonProfile).mockRejectedValue(new Error('Could not save.'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Tuesday' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save.');
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a staff barber does not get the picker', async () => {
    vi.mocked(barber.fetchMe).mockResolvedValue({ ...OWNER, role: 'BARBER' });
    renderSettings();
    await screen.findByRole('link', { name: /salon qr code/i });
    expect(screen.queryByRole('group', { name: 'Weekly off days' })).not.toBeInTheDocument();
  });

  it('a salon from before this feature (no weeklyOffDays in the reply) counts as open every day', async () => {
    const { weeklyOffDays: _ignored, ...old } = PROFILE;
    vi.mocked(barber.fetchBarberSalonProfile).mockResolvedValue(old);
    renderSettings();
    expect(await screen.findByText(/Open every day/)).toBeInTheDocument();
  });
});
