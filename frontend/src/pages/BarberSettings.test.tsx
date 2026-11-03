// frontend/src/pages/BarberSettings.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberSettings from './BarberSettings';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';
import type { BarberSalonProfile } from '../api/barber';

vi.mock('../api/barber', () => ({
  fetchBarberSalonProfile: vi.fn(),
  updateBarberSalonProfile: vi.fn(),
  logoutBarber: vi.fn(),
  fetchBarberServices: vi.fn(),
  addBarberService: vi.fn(),
  removeBarberService: vi.fn(),
}));

const salon: BarberSalonProfile = {
  id: 'salon-1',
  name: 'Style Studio',
  qrCode: 'abc123',
  phone: '+919876543210',
  address: '12 MG Road, Indore',
  openingTime: '09:00',
  closingTime: '21:00',
  averageServiceMinutes: 15,
};

const renderSettings = () => renderPage(<BarberSettings />, { path: '/barber/settings', route: '/barber/settings' });

beforeEach(() => {
  vi.mocked(barber.fetchBarberSalonProfile).mockReset().mockResolvedValue(salon);
  vi.mocked(barber.updateBarberSalonProfile).mockReset();
  vi.mocked(barber.logoutBarber).mockReset();
  vi.mocked(barber.fetchBarberServices).mockReset().mockResolvedValue([
  { id: 's1', name: 'hair cutting' },
  { id: 's2', name: 'beard trimming' },
  ]);
});

describe('BarberSettings profile form', () => {
  it('pre-fills the form and keeps Save disabled until something changes', async () => {
    renderSettings();
    expect(await screen.findByLabelText('Salon name')).toHaveValue('Style Studio');
    expect(screen.getByLabelText('Opens at')).toHaveValue('09:00');
    expect(screen.getByLabelText('Closes at')).toHaveValue('21:00');
    expect(screen.getByLabelText(/average time per customer/i)).toHaveValue('15');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('sends only the fields that changed', async () => {
    vi.mocked(barber.updateBarberSalonProfile).mockResolvedValue({ ...salon, averageServiceMinutes: 20 });
    const user = userEvent.setup();
    renderSettings();

    const minutes = await screen.findByLabelText(/average time per customer/i);
    await user.clear(minutes);
    await user.type(minutes, '20');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(barber.updateBarberSalonProfile).toHaveBeenCalledWith({ averageServiceMinutes: 20 });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows the server error and keeps the form usable', async () => {
    vi.mocked(barber.updateBarberSalonProfile).mockRejectedValue(new Error('Enter a valid mobile number'));
    const user = userEvent.setup();
    renderSettings();

    const phone = await screen.findByLabelText('Phone number');
    await user.clear(phone);
    await user.type(phone, '123');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('valid mobile number');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('blocks a closing time that is not after opening, without calling the API', async () => {
    const user = userEvent.setup();
    renderSettings();

    fireEvent.change(await screen.findByLabelText('Opens at'), { target: { value: '22:00' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Closing time must be after opening time');
    expect(barber.updateBarberSalonProfile).not.toHaveBeenCalled();
  });
  it('logs out from Settings and leaves for the login page', async () => {
    vi.mocked(barber.logoutBarber).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(barber.logoutBarber).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
  });
  it('links to the QR poster and the Offers page', async () => {
    renderSettings();
    expect(await screen.findByRole('link', { name: /salon qr code/i })).toHaveAttribute('href', '/barber/qr');
    expect(screen.getByRole('link', { name: /offers/i })).toHaveAttribute('href', '/barber/offers');
  });
});