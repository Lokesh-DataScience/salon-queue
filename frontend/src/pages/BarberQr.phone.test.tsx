// frontend/src/pages/BarberQr.phone.test.tsx
// The salon's phone is printed as plain text under the QR. The QR itself still holds only the join link.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import BarberQr from './BarberQr';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';

vi.mock('../api/barber', () => ({ fetchBarberSalon: vi.fn() }));
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="qr" data-value={value} />,
}));

const renderQr = () => renderPage(<BarberQr />, { path: '/barber/qr', route: '/barber/qr' });

beforeEach(() => {
  vi.mocked(barber.fetchBarberSalon).mockReset();
});

describe('Salon QR poster: phone number', () => {
  it('prints the salon phone under the name', async () => {
    vi.mocked(barber.fetchBarberSalon).mockResolvedValue({ id: 's1', name: 'Style Studio', qrCode: 'abc123', phone: '+919876543210' });
    renderQr();
    expect(await screen.findByText('Style Studio')).toBeInTheDocument();
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
  });

  it('never puts the phone number in the QR: it holds only the join link', async () => {
    vi.mocked(barber.fetchBarberSalon).mockResolvedValue({ id: 's1', name: 'Style Studio', qrCode: 'abc123', phone: '+919876543210' });
    renderQr();
    const qr = await screen.findByTestId('qr');
    expect(qr.getAttribute('data-value')).toMatch(/\/q\/abc123$/);
    expect(qr.getAttribute('data-value')).not.toContain('9876543210');
  });

  it('shows no phone line when the salon has none', async () => {
    vi.mocked(barber.fetchBarberSalon).mockResolvedValue({ id: 's1', name: 'Style Studio', qrCode: 'abc123' });
    renderQr();
    expect(await screen.findByText('Style Studio')).toBeInTheDocument();
    expect(screen.queryByText(/Call:/)).not.toBeInTheDocument();
  });
});