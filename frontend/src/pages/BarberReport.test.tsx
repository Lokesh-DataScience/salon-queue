// frontend/src/pages/BarberReport.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberReport from './BarberReport';
import { renderPage } from '../test/utils';
import * as bugs from '../api/bugReports';

vi.mock('../api/bugReports', () => ({ fetchMyBugReports: vi.fn(), sendBugReport: vi.fn() }));

const renderIt = () => renderPage(<BarberReport />, { path: '/barber/report', route: '/barber/report' });

beforeEach(() => {
  vi.mocked(bugs.fetchMyBugReports).mockReset().mockResolvedValue([
    { id: 'r1', createdAt: '2026-11-10T06:00:00Z', kind: 'question', message: 'How do I print the QR?', status: 'fixed',
      techNote: 'Settings → Salon QR code → Print.' },
  ]);
  vi.mocked(bugs.sendBugReport).mockReset().mockImplementation(async (i) => ({
    id: 'new', createdAt: new Date().toISOString(), kind: i.kind, message: i.message, status: 'new', techNote: '',
  }));
});

describe('BarberReport', () => {
  it('sends a report with its kind and the phone/browser, and says thanks', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('radio', { name: 'An idea' }));
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Tell us what happened'), 'Please add a dark mode.');
    await user.click(send);
    expect(bugs.sendBugReport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idea', message: 'Please add a dark mode.', device: expect.any(String) }),
    );
    expect(await screen.findByText(/we've got it/i)).toBeInTheDocument();
  });

  it('asks people not to type customer details', () => {
    renderIt();
    expect(screen.getByText(/don't write customers' names or phone numbers/i)).toBeInTheDocument();
  });

  it('lists earlier reports with their status and the reply', async () => {
    renderIt();
    const mine = await screen.findByRole('region', { name: 'Your reports' });
    expect(within(mine).getByText('Fixed')).toBeInTheDocument();
    expect(within(mine).getByText('Reply: Settings → Salon QR code → Print.')).toBeInTheDocument();
  });
});
