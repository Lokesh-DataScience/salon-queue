// frontend/src/pages/BarberStats.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { focusManager } from '@tanstack/react-query';
import BarberStats from './BarberStats';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';
import type { BarberStats as Stats, StatsDay } from '../api/barber';

vi.mock('../api/barber', () => ({ fetchBarberStats: vi.fn() }));

function makeDays(start: string, n: number, counts: Record<string, number> = {}): StatsDay[] {
  const [y, m, d] = start.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    return { date, count: counts[date] ?? 0 };
  });
}

const STATS: Stats = {
  today: '2026-11-04',
  servedToday: 12,
  walkInToday: 3,
  qrToday: 9,
  servedYesterday: 10,
  week: {
    start: '2026-11-02',
    total: 30,
    walkIn: 7,
    qr: 23,
    prevSamePeriod: 26,
    days: makeDays('2026-11-02', 7, { '2026-11-02': 18, '2026-11-03': 10, '2026-11-04': 2 }),
  },
  month: {
    start: '2026-11-01',
    total: 41,
    walkIn: 9,
    qr: 32,
    prevSamePeriod: 45,
    days: makeDays('2026-11-01', 30, { '2026-11-03': 8 }),
  },
};

const EMPTY: Stats = {
  ...STATS,
  servedToday: 0,
  walkInToday: 0,
  qrToday: 0,
  servedYesterday: 0,
  week: { ...STATS.week, total: 0, walkIn: 0, qr: 0, prevSamePeriod: 0, days: makeDays('2026-11-02', 7) },
  month: { ...STATS.month, total: 0, walkIn: 0, qr: 0, prevSamePeriod: 0, days: makeDays('2026-11-01', 30) },
};

const renderStats = () => renderPage(<BarberStats />, { path: '/barber/stats', route: '/barber/stats' });

beforeEach(() => {
  vi.mocked(barber.fetchBarberStats).mockReset().mockResolvedValue(STATS);
});

describe('BarberStats page', () => {
  it('shows a loading state, then today\'s numbers with the QR and walk-in split', async () => {
    renderStats();
    expect(screen.getByText(/loading customers/i)).toBeInTheDocument();

    expect(await screen.findByTestId('served-total')).toHaveTextContent('12');
    expect(screen.getByTestId('qr-count')).toHaveTextContent('9');
    expect(screen.getByTestId('walkin-count')).toHaveTextContent('3');
    expect(screen.getByText(/2 more than yesterday/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    // Today has no daily chart.
    expect(screen.queryByRole('list', { name: /per day/i })).not.toBeInTheDocument();
  });

  it('week view: total, comparison with the same days last week, and 7 day bars', async () => {
    const user = userEvent.setup();
    renderStats();
    await screen.findByTestId('served-total');

    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(screen.getByTestId('served-total')).toHaveTextContent('30');
    expect(screen.getByTestId('qr-count')).toHaveTextContent('23');
    expect(screen.getByTestId('walkin-count')).toHaveTextContent('7');
    expect(screen.getByText(/4 more than the same days last week/i)).toBeInTheDocument();

    const list = screen.getByRole('list', { name: /per day this week/i });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(7);
    expect(items[2]).toHaveAttribute('aria-current', 'date'); // 4 Nov is today
    expect(within(list).getByText(/2 customers/)).toBeInTheDocument();
    expect(within(list).getAllByText(/upcoming/)).toHaveLength(4); // Thu to Sun
  });

  it('month view: fewer than last month is worded, and every day of the month is listed', async () => {
    const user = userEvent.setup();
    renderStats();
    await screen.findByTestId('served-total');

    await user.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByTestId('served-total')).toHaveTextContent('41');
    expect(screen.getByText(/4 fewer than the same days last month/i)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /per day this month/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(30);
  });

  it('shows a friendly empty state with no upsell language', async () => {
    vi.mocked(barber.fetchBarberStats).mockResolvedValue(EMPTY);
    renderStats();
    expect(await screen.findByText(/no customers served yet today/i)).toBeInTheDocument();
    expect(screen.getByTestId('served-total')).toHaveTextContent('0');
    expect(screen.getByText(/same as yesterday/i)).toBeInTheDocument();
    expect(screen.queryByText(/upgrade|premium|pro plan|unlock|subscribe/i)).not.toBeInTheDocument();
  });

  it('shows a readable error with Try again, and recovers', async () => {
    vi.mocked(barber.fetchBarberStats).mockReset().mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderStats();

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(/could not load your numbers/i);
    expect(alert).not.toHaveTextContent(/boom/);

    vi.mocked(barber.fetchBarberStats).mockResolvedValue(STATS);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('served-total')).toHaveTextContent('12');
  });

  it('refetches when the browser tab regains focus (no polling)', async () => {
    renderStats();
    await screen.findByTestId('served-total');
    expect(barber.fetchBarberStats).toHaveBeenCalledTimes(1);

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(barber.fetchBarberStats).toHaveBeenCalledTimes(2));
  });
});