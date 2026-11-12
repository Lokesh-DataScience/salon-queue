// frontend/src/components/admin/LeadsPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeadsPanel, { isDue } from './LeadsPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { Lead } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  fetchLeads: vi.fn(),
  createLead: vi.fn(),
  updateLead: vi.fn(),
  deleteLead: vi.fn(),
  fetchSalesActivity: vi.fn(),
}));

const lead = (over: Partial<Lead>): Lead => ({
  id: 'x', name: 'Lead', ownerName: '', phone: '', area: '', address: '', status: 'contacted',
  followUpOn: null, notes: '', salonId: null, salonName: null,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...over,
});

const due = lead({ id: 'a', name: 'Raju Hair Point', ownerName: 'Raju', phone: '9876543210', area: 'Korba', followUpOn: '2026-11-12' });
const later = lead({ id: 'b', name: 'Later Salon', followUpOn: '2026-11-20' });
const done = lead({ id: 'c', name: 'Signed Salon', status: 'converted', followUpOn: '2026-11-01', salonName: 'Signed Salon Korba' });

const renderIt = () => renderPage(<LeadsPanel />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchLeads).mockReset().mockResolvedValue({ today: '2026-11-12', leads: [due, later, done] });
  vi.mocked(admin.createLead).mockReset().mockImplementation(async (i) => lead({ ...i, id: 'new' }));
  vi.mocked(admin.updateLead).mockReset().mockImplementation(async (id, i) => lead({ ...i, id }));
  vi.mocked(admin.deleteLead).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(admin.fetchSalesActivity).mockReset().mockResolvedValue({ today: '2026-11-12', salons: [], areas: [] });
});

describe('LeadsPanel', () => {
  it('opens on follow-ups due today, with a call link', async () => {
    renderIt();
    const list = await screen.findByRole('list', { name: 'Leads' });
    expect(within(list).getByText('Raju Hair Point')).toBeInTheDocument();
    expect(within(list).getByText('Follow up today')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: '9876543210' })).toHaveAttribute('href', 'tel:9876543210');
    expect(within(list).queryByText('Later Salon')).not.toBeInTheDocument();
    expect(within(list).queryByText('Signed Salon')).not.toBeInTheDocument(); // closed leads are never "due"
  });

  it('filters open, signed up and all', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Leads' });
    await user.click(screen.getByRole('button', { name: 'Open (2)' }));
    expect(screen.getByText('Later Salon')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Signed up (1)' }));
    expect(screen.getByText('Registered as Signed Salon Korba')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All (3)' }));
    expect(within(screen.getByRole('list', { name: 'Leads' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('adds a lead', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Add a lead' }));
    const form = screen.getByRole('form', { name: 'New lead' });
    await user.type(within(form).getByLabelText('Salon name'), 'Shiv Salon');
    await user.type(within(form).getByLabelText('Phone'), '9123456780');
    await user.selectOptions(within(form).getByLabelText('Status'), 'interested');
    await user.click(within(form).getByRole('button', { name: 'Add lead' }));
    expect(admin.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Shiv Salon', phone: '9123456780', status: 'interested', followUpOn: null, salonId: null }),
    );
  });

  it('edits and deletes a lead only after a second tap', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Edit lead Raju Hair Point' }));
    await user.click(screen.getByRole('button', { name: 'Delete lead' }));
    expect(admin.deleteLead).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, delete this lead' }));
    expect(admin.deleteLead).toHaveBeenCalledWith('a');
  });

  it('due rules', () => {
    expect(isDue(lead({ followUpOn: '2026-11-11' }), '2026-11-12')).toBe(true);
    expect(isDue(lead({ followUpOn: '2026-11-13' }), '2026-11-12')).toBe(false);
    expect(isDue(lead({ followUpOn: '2026-11-11', status: 'not_interested' }), '2026-11-12')).toBe(false);
    expect(isDue(lead({ followUpOn: null }), '2026-11-12')).toBe(false);
  });
});
