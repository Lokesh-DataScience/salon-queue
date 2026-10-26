import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberQr from './BarberQr';
import { renderPage } from '../test/utils';
import { ApiError } from '../api/client';
import * as barber from '../api/barber';

vi.mock('../api/barber', () => ({ fetchBarberSalon: vi.fn() }));

const renderQr = () => renderPage(<BarberQr />, { path: '/barber/qr', route: '/barber/qr' });

beforeEach(() => {
  vi.mocked(barber.fetchBarberSalon).mockReset();
});

describe('BarberQr (printable wall poster)', () => {
  it("shows the salon's name, a QR code, and the exact link behind it", async () => {
    vi.mocked(barber.fetchBarberSalon).mockResolvedValue({ id: 's1', name: 'Milan Hair Salon', qrCode: '87bcee043619' });
    const { container } = renderQr();

    expect(await screen.findByRole('heading', { name: 'Milan Hair Salon' })).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText(`Link behind the QR: ${window.location.origin}/q/87bcee043619`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print this QR code' })).toBeInTheDocument();
  });

  it('opens the browser print dialog', async () => {
    vi.mocked(barber.fetchBarberSalon).mockResolvedValue({ id: 's1', name: 'Milan Hair Salon', qrCode: '87bcee043619' });
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderQr();

    await userEvent.click(await screen.findByRole('button', { name: 'Print this QR code' }));
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('asks a signed-out barber to log in instead of showing a QR', async () => {
    vi.mocked(barber.fetchBarberSalon).mockImplementation(() => Promise.reject(new ApiError('Not authenticated.', 401)));
    renderQr();

    expect(await screen.findByRole('alert')).toHaveTextContent(/not signed in/i);
    expect(screen.getByRole('link', { name: 'Go to Login' })).toBeInTheDocument();
  });
});
