// frontend/src/components/admin/ToolsPanel.test.tsx — Admin Slice 11
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToolsPanel from './ToolsPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';

vi.mock('../../api/admin', () => ({
  fetchTestSalons: vi.fn(),
  runTestAction: vi.fn(),
  fetchFlags: vi.fn(),
  updateFlag: vi.fn(),
}));

const SALON = { id: 'salon-t', name: 'Demo Salon', hours: '09:00–21:00', isSuspended: false };
const NOTICE = {
  key: 'barber_notice',
  enabled: false,
  value: '',
  description: 'Shows a notice bar on barber screens.',
  updatedAt: new Date().toISOString(),
};

const renderTools = () => renderPage(<ToolsPanel />, { path: '/barber/admin', route: '/barber/admin?tab=tech&view=tools' });

beforeEach(() => {
  vi.mocked(admin.fetchTestSalons).mockReset().mockResolvedValue([SALON]);
  vi.mocked(admin.runTestAction).mockReset();
  vi.mocked(admin.fetchFlags).mockReset().mockResolvedValue([NOTICE]);
  vi.mocked(admin.updateFlag).mockReset().mockResolvedValue({ ok: true });
});

describe('Tools & flags (Slice 11)', () => {
  it('adds a QR test customer and links to their ticket', async () => {
    vi.mocked(admin.runTestAction).mockResolvedValue({ token: 7, ticketUrl: '/tickets/e1?accessToken=abc' });
    renderTools();
    await userEvent.click(await screen.findByRole('button', { name: /add qr customer/i }));
    expect(admin.runTestAction).toHaveBeenCalledWith('salon-t', 'scan', undefined);
    expect(await screen.findByText(/added test customer #7/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open their ticket/i })).toHaveAttribute('href', '/tickets/e1?accessToken=abc');
  });

  it('needs a token for a test push and shows the server message when it fails', async () => {
    vi.mocked(admin.runTestAction).mockRejectedValue(new Error("Token #3 hasn't turned notifications on."));
    renderTools();
    const push = await screen.findByRole('button', { name: /send test push/i });
    expect(push).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/token number/i), '3');
    await userEvent.click(push);
    expect(admin.runTestAction).toHaveBeenCalledWith('salon-t', 'push', { token: 3 });
    expect(await screen.findByRole('alert')).toHaveTextContent(/hasn't turned notifications on/i);
  });

  it('explains what to do when there are no internal salons', async () => {
    vi.mocked(admin.fetchTestSalons).mockResolvedValue([]);
    renderTools();
    expect(await screen.findByText(/no internal salons yet/i)).toBeInTheDocument();
  });

  it('switches a flag on and saves its text', async () => {
    renderTools();
    const flags = await screen.findByRole('region', { name: /feature flags/i });
    await userEvent.click(await within(flags).findByRole('button', { name: /barber_notice: off/i }));
    expect(admin.updateFlag).toHaveBeenCalledWith('barber_notice', { enabled: true });

    const input = within(flags).getByLabelText(/text/i);
    await userEvent.type(input, 'Maintenance at 11 pm');
    await userEvent.click(within(flags).getByRole('button', { name: /^save$/i }));
    expect(admin.updateFlag).toHaveBeenCalledWith('barber_notice', { value: 'Maintenance at 11 pm' });
  });
});
