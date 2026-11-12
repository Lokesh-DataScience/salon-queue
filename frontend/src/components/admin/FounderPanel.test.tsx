// frontend/src/components/admin/FounderPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import FounderPanel from './FounderPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { FounderOverview } from '../../api/admin';

vi.mock('../../api/admin', () => ({ fetchFounderOverview: vi.fn() }));

function sample(): FounderOverview {
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(2026, 9, 14 + i); // 14 Oct … 12 Nov 2026
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { date: ymd, tickets: i, served: Math.floor(i / 2) };
  });
  return {
    today: '2026-11-12',
    weekStart: '2026-11-09',
    monthStart: '2026-11-01',
    salons: { total: 12, newThisMonth: 3, active7d: 9 },
    periods: {
      today: { tickets: 40, walkIn: 10, qr: 30, served: 35, ticketsYesterday: 32 },
      week: { tickets: 150, walkIn: 40, qr: 110, served: 140 },
      month: { tickets: 1234, walkIn: 300, qr: 934, served: 1100 },
    },
    days,
  };
}

const renderPanel = () => renderPage(<FounderPanel />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchFounderOverview).mockReset().mockResolvedValue(sample());
});

describe('FounderPanel', () => {
  it('shows the headline numbers', async () => {
    renderPanel();
    expect(await screen.findByTestId('salons-total')).toHaveTextContent('12');
    expect(screen.getByText('3 new this month')).toBeInTheDocument();
    expect(screen.getByTestId('salons-active')).toHaveTextContent('9');
    expect(screen.getByTestId('tickets-today')).toHaveTextContent('40');
    expect(screen.getByText('30 QR · 10 walk-in')).toBeInTheDocument();
    expect(screen.getByTestId('served-today')).toHaveTextContent('35');
    expect(screen.getByText(/8 more than yesterday/)).toBeInTheDocument();
  });

  it('shows today, week and month in the table, with Indian number formatting', async () => {
    renderPanel();
    const month = await screen.findByRole('row', { name: /this month/i });
    expect(within(month).getByText('1,234')).toBeInTheDocument();
    expect(within(month).getByText('1,100')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /this week/i })).toHaveTextContent('150');
  });

  it('draws 30 days with readable labels and marks today', async () => {
    renderPanel();
    const list = await screen.findByRole('list', { name: 'Tickets per day' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(30);
    expect(items[29]).toHaveAttribute('aria-current', 'date');
    expect(items[29]).toHaveTextContent(/today.*29 tickets, 14 served/i);
  });

  it('shows a retry message when loading fails', async () => {
    vi.mocked(admin.fetchFounderOverview).mockRejectedValue(new Error('down'));
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load the numbers/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
