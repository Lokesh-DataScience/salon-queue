// frontend/src/pages/BarberQr.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberQr, { headerLayout } from './BarberQr';
import { renderPage } from '../test/utils';
import { ApiError } from '../api/client';
import * as barber from '../api/barber';

vi.mock('../api/barber', () => ({ fetchBarberSalon: vi.fn() }));

const renderQr = () => renderPage(<BarberQr />, { path: '/barber/qr', route: '/barber/qr' });

beforeEach(() => {
  vi.mocked(barber.fetchBarberSalon).mockReset();
});

describe('BarberQr (printable wall poster)', () => {
  it("draws this salon's own poster: its name in the header, a QR, and the exact link behind it", async () => {
    vi.mocked(barber.fetchBarberSalon).mockResolvedValue({ id: 's1', name: 'Milan Hair Salon', qrCode: '87bcee043619' });
    renderQr();

    const poster = await screen.findByRole('img', { name: 'QR poster for Milan Hair Salon' });
    expect(screen.getByRole('heading', { name: /Milan Hair Salon/ })).toBeInTheDocument();
    expect(screen.getByText('MILAN HAIR SALON')).toBeInTheDocument();
    expect(poster.querySelector('image')?.getAttribute('href')).toBe('/qr-poster-bg.jpg');
    expect(poster.querySelector('svg')).not.toBeNull(); // the QR, inside the poster
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

  it('offers a download, and no Share button where the browser cannot share files', async () => {
    vi.mocked(barber.fetchBarberSalon).mockResolvedValue({ id: 's1', name: 'Milan Hair Salon', qrCode: '87bcee043619' });
    renderQr();

    expect(await screen.findByRole('button', { name: 'Download image' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument();
  });

  it('asks a signed-out barber to log in instead of showing a QR', async () => {
    vi.mocked(barber.fetchBarberSalon).mockImplementation(() => Promise.reject(new ApiError('Not authenticated.', 401)));
    renderQr();

    expect(await screen.findByRole('alert')).toHaveTextContent(/not signed in/i);
    expect(screen.getByRole('link', { name: 'Go to Login' })).toBeInTheDocument();
  });
});

describe('headerLayout (salon name in the navy tab)', () => {
  it('keeps a short name on one big line', () => {
    const l = headerLayout('MILAN HAIR SALON', true);
    expect(l.name).toHaveLength(1);
    expect(l.name[0].size).toBeGreaterThanOrEqual(34);
    expect(l.phone).toBeDefined();
  });

  it('splits a long name over two even lines instead of shrinking it to nothing', () => {
    const l = headerLayout('SHREE GANESH GENTS BEAUTY PARLOUR', true);
    expect(l.name.map((n) => n.text)).toEqual(['SHREE GANESH GENTS', 'BEAUTY PARLOUR']);
    expect(l.name[0].size).toBeGreaterThanOrEqual(20);
  });

  it('leaves out the phone line when there is no phone', () => {
    expect(headerLayout('MILAN HAIR SALON', false).phone).toBeUndefined();
  });

  it('never goes below the smallest readable size, even for one very long word', () => {
    const l = headerLayout('SUPERCALIFRAGILISTICEXPIALIDOCIOUSSALON', false);
    expect(l.name).toHaveLength(1);
    expect(l.name[0].size).toBe(20);
  });
});
