// frontend/src/components/admin/BugsPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BugsPanel from './BugsPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { BugReport } from '../../api/admin';

vi.mock('../../api/admin', () => ({ fetchBugs: vi.fn(), updateBug: vi.fn() }));

const bug: BugReport = {
  id: 'b1', createdAt: new Date().toISOString(), kind: 'bug', message: 'The +1 button did nothing.',
  page: '/barber/dashboard', device: 'Android 13 Chrome', status: 'new', techNote: '', updatedAt: new Date().toISOString(),
  salonId: 's1', salonName: 'Milan Hair Salon', reporter: { name: 'Milan', contact: 'milan@example.com' },
};

const renderIt = () => renderPage(<BugsPanel />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchBugs).mockReset().mockResolvedValue([bug]);
  vi.mocked(admin.updateBug).mockReset().mockResolvedValue({ report: { id: 'b1' } });
});

describe('BugsPanel', () => {
  it('shows the report with salon, reporter, page and device', async () => {
    renderIt();
    const list = await screen.findByRole('list', { name: 'Bug reports' });
    expect(within(list).getByText('The +1 button did nothing.')).toBeInTheDocument();
    expect(within(list).getByText('Milan Hair Salon')).toBeInTheDocument();
    expect(within(list).getByText(/milan@example.com · from \/barber\/dashboard/)).toBeInTheDocument();
    expect(within(list).getByText('Android 13 Chrome')).toBeInTheDocument();
  });

  it('saves a status and a reply; Save stays off until something changes', async () => {
    const user = userEvent.setup();
    renderIt();
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Status'), 'fixed');
    await user.type(screen.getByLabelText(/reply to the barber/i), 'Fixed in the latest update.');
    await user.click(save);
    expect(admin.updateBug).toHaveBeenCalledWith('b1', { status: 'fixed', techNote: 'Fixed in the latest update.' });
  });

  it('switches between open and all', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Bug reports' });
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(admin.fetchBugs).toHaveBeenLastCalledWith('all');
  });
});
