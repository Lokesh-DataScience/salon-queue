// frontend/src/components/admin/SalesPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SalesPanel from './SalesPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { SalesSalon } from '../../api/admin';

vi.mock('../../api/admin', () => ({ fetchSalesActivity: vi.fn(), updateSalesInfo: vi.fn() }));

const base: SalesSalon = {
  id: 'a',
  name: 'Quiet Cuts',
  phone: '9000000000',
  address: 'Station Road',
  area: 'Korba, Chhattisgarh',
  createdAt: '2026-10-01T06:00:00Z',
  isSuspended: false,
  owner: { name: 'Ravi', email: 'ravi@example.com', phone: '9876543210' },
  lastTicketAt: '2026-11-05T06:00:00Z',
  daysSinceLastTicket: 7,
  tickets7d: 0,
  avgPerDay7d: 0,
  ticketsThisMonth: 4,
  churnRisk: true,
  isPartner: false,
  notes: '',
  infoUpdatedAt: null,
};
const busy: SalesSalon = {
  ...base,
  id: 'b',
  name: 'Busy Barbers',
  daysSinceLastTicket: 0,
  tickets7d: 70,
  avgPerDay7d: 10,
  ticketsThisMonth: 120,
  churnRisk: false,
  isPartner: true,
  notes: 'Tester salon, free.',
};

const renderIt = () => renderPage(<SalesPanel />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchSalesActivity).mockReset().mockResolvedValue({
    today: '2026-11-12',
    salons: [base, busy],
    areas: [{ area: 'Korba, Chhattisgarh', salons: 2, activeSalons7d: 1, ticketsThisMonth: 124 }],
  });
  vi.mocked(admin.updateSalesInfo).mockReset().mockResolvedValue({ info: { salonId: 'a', isPartner: true, notes: 'x' } });
});

describe('SalesPanel', () => {
  it('lists salons with churn and partner labels, last ticket and contact links', async () => {
    renderIt();
    const list = await screen.findByRole('list', { name: 'Salon activity' });
    expect(within(list).getByText('Churn risk')).toBeInTheDocument();
    expect(within(list).getByText('Partner')).toBeInTheDocument();
    expect(within(list).getByText('Last ticket 7 days ago')).toBeInTheDocument();
    expect(within(list).getByText('Last ticket today')).toBeInTheDocument();
    expect(within(list).getAllByRole('link', { name: '9876543210' })[0]).toHaveAttribute('href', 'tel:9876543210');
    expect(within(list).getByText('Tester salon, free.')).toBeInTheDocument();
  });

  it('filters to churn risk and to partners', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Salon activity' });

    await user.click(screen.getByRole('button', { name: 'Churn risk (1)' }));
    let list = screen.getByRole('list', { name: 'Salon activity' });
    expect(within(list).getByText('Quiet Cuts')).toBeInTheDocument();
    expect(within(list).queryByText('Busy Barbers')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Partners (1)' }));
    list = screen.getByRole('list', { name: 'Salon activity' });
    expect(within(list).getByText('Busy Barbers')).toBeInTheDocument();
    expect(within(list).queryByText('Quiet Cuts')).not.toBeInTheDocument();
  });

  it('shows the area breakdown', async () => {
    renderIt();
    const row = await screen.findByRole('row', { name: /korba, chhattisgarh/i });
    expect(row).toHaveTextContent('124');
  });

  it('saves the partner flag and notes', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Edit notes for Quiet Cuts' }));
    await user.click(screen.getByRole('checkbox', { name: 'Partner salon' }));
    await user.type(screen.getByLabelText('Notes'), 'Call back Friday');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(admin.updateSalesInfo).toHaveBeenCalledWith('a', { isPartner: true, notes: 'Call back Friday' });
  });
});
