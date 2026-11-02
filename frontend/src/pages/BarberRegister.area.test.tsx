// frontend/src/pages/BarberRegister.area.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberRegister from './BarberRegister';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';
import * as feed from '../api/feed';

vi.mock('../api/barber', () => ({ registerSalon: vi.fn() }));
vi.mock('../api/feed', () => ({ fetchSalonFeed: vi.fn(), reverseGeocode: vi.fn() }));

const renderRegister = () => renderPage(<BarberRegister />, { path: '/barber/register', route: '/barber/register' });

beforeEach(() => {
  vi.mocked(barber.registerSalon).mockReset().mockResolvedValue({ staff: {} as never });
  vi.mocked(feed.reverseGeocode).mockReset();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 22.410114, longitude: 82.60959 } } as GeolocationPosition),
    },
  });
});

describe('BarberRegister: district prefill', () => {
  it('fills district, district and state from the location, and sends them on submit', async () => {
    vi.mocked(feed.reverseGeocode).mockResolvedValue({ district: 'कोरबा', state: 'छत्तीसगढ़' });
    const user = userEvent.setup();
    renderRegister();

    await user.click(screen.getByRole('button', { name: /use my current location/i }));
    await waitFor(() => expect(screen.getByLabelText('District')).toHaveValue('कोरबा'));
    expect(screen.getByLabelText('State')).toHaveValue('छत्तीसगढ़');
    expect(feed.reverseGeocode).toHaveBeenCalledWith(22.410114, 82.60959);

    await user.click(screen.getByRole('button', { name: 'Register salon' }));
    expect(barber.registerSalon).toHaveBeenCalledWith(
      expect.objectContaining({ district: 'कोरबा', state: 'छत्तीसगढ़' }),
    );
  });

  it('never overwrites a field the owner edited', async () => {
    vi.mocked(feed.reverseGeocode).mockResolvedValue({ district: 'Korba', state: 'Chhattisgarh' });
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText('District'), 'Korba');
    await user.click(screen.getByRole('button', { name: /use my current location/i }));
    await waitFor(() => expect(screen.getByLabelText('District')).toHaveValue('Korba'));
    expect(screen.getByLabelText('District')).toHaveValue('Korba');
  });

  it('a failed lookup shows a note and does not block typing or registering', async () => {
    vi.mocked(feed.reverseGeocode).mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    renderRegister();

    await user.click(screen.getByRole('button', { name: /use my current location/i }));
    expect(await screen.findByText(/please type it in/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('District'), 'Korba');
    await user.click(screen.getByRole('button', { name: 'Register salon' }));
    expect(barber.registerSalon).toHaveBeenCalledWith(expect.objectContaining({ district: 'Korba' }));
  });
});