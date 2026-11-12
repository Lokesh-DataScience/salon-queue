// frontend/src/components/admin/QueueHealthPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueueHealthPanel from './QueueHealthPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { QueueHealth } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  fetchQueueHealth: vi.fn(),
  searchTechSalons: vi.fn(),
  fetchReadOnlyQueue: vi.fn(),
}));

const health: QueueHealth = {
  checkedAt: new Date().toISOString(),
  checks: [
    { id: 'duplicate_tokens', label: 'Same token given twice', serious: true, count: 0, rows: [] },
    { id: 'double_serving', label: 'Two customers serving at once in one line', serious: true, count: 0, rows: [] },
    { id: 'overdue_serving', label: 'Service ran 2+ minutes past its end time', serious: false, count: 1,
      rows: [{ salon_id: 's1', salon: 'Milan Hair Salon', token: 7, minutes_over: 12 }] },
    { id: 'stale_active', label: 'Open tickets left from an earlier day', serious: false, count: 0, rows: [] },
    { id: 'stuck_paused', label: 'Queue paused 2+ hours with people waiting', serious: false, count: 0, rows: [] },
  ],
  pushToday: { qrTickets: 20, withPush: 15, gotClose: 10, gotNext: 8, gotTurn: 6 },
  pushDelivery: {
    today: { day: '2026-11-12', sent: 18, expired: 1, failed: 1, lastFailureCode: 'HTTP_500' },
    lastDays: [],
    total: { sent: 90, expired: 5, failed: 5 },
  },
};

const renderIt = () => renderPage(<QueueHealthPanel />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchQueueHealth).mockReset().mockResolvedValue(health);
  vi.mocked(admin.searchTechSalons).mockReset().mockResolvedValue([
    { id: 's1', name: 'Milan Hair Salon', address: 'Main Road', isInternal: false, isSuspended: false },
  ]);
  vi.mocked(admin.fetchReadOnlyQueue).mockReset().mockResolvedValue({
    salon: { id: 's1', name: 'Milan Hair Salon', isOpen: true, isQueueActive: true, isSuspended: false, hours: '09:00–21:00' },
    date: '2026-11-12',
    queue: { status: 'ACTIVE', nextToken: 9, updatedAt: new Date().toISOString() },
    entries: [
      { token: 7, status: 'SERVING', walkIn: false, line: 1, joinedAt: '2026-11-12T05:00:00Z', startedAt: '2026-11-12T05:10:00Z',
        endsAt: '2026-11-12T05:25:00Z', completedAt: null, priority: false, durationMinutes: 15, notifiedStage: 3 },
      { token: 8, status: 'WAITING', walkIn: true, line: 1, joinedAt: '2026-11-12T05:05:00Z', startedAt: null,
        endsAt: null, completedAt: null, priority: false, durationMinutes: null, notifiedStage: 0 },
    ],
  });
});

describe('QueueHealthPanel', () => {
  it('shows each check as OK or with what was found', async () => {
    renderIt();
    const checks = await screen.findByRole('region', { name: 'Queue checks' });
    expect(within(checks).getAllByText('OK')).toHaveLength(4);
    expect(within(checks).getByText('1 found')).toBeInTheDocument();
    expect(within(checks).getByRole('button', { name: 'Milan Hair Salon · token #7 · 12 min over' })).toBeInTheDocument();
  });

  it('shows today\'s notification numbers', async () => {
    renderIt();
    const n = await screen.findByRole('region', { name: 'Notifications today' });
    expect(within(n).getByText('15 (75%)')).toBeInTheDocument();
    expect(within(n).getByText('18 (90%)')).toBeInTheDocument();
    expect(within(n).getByText('1 (last: HTTP_500)')).toBeInTheDocument();
    expect(within(n).getByText('90 of 100 (90%)')).toBeInTheDocument();
  });

  it('opens a salon queue read-only from a check, and from search', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: /token #7 · 12 min over/ }));
    const q = await screen.findByRole('region', { name: 'Salon queue' });
    expect(within(q).getByText(/read-only/i)).toBeInTheDocument();
    expect(await within(q).findByText('#8 (walk-in)')).toBeInTheDocument();
    expect(admin.fetchReadOnlyQueue).toHaveBeenCalledWith('s1');

    await user.click(within(q).getByRole('button', { name: '‹ Back' }));
    await user.type(screen.getByLabelText('Salon name or address'), 'Milan');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    expect(admin.searchTechSalons).toHaveBeenCalledWith('Milan');
    expect(await screen.findByRole('list', { name: 'Matching salons' })).toBeInTheDocument();
  });
});
