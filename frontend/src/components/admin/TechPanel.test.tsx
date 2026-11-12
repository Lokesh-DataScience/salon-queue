// frontend/src/components/admin/TechPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import TechPanel, { ago } from './TechPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { TechHealth } from '../../api/admin';

vi.mock('../../api/admin', () => ({ fetchTechHealth: vi.fn() }));

const now = new Date().toISOString();
function sample(over: Partial<TechHealth> = {}): TechHealth {
  return {
    checkedAt: now,
    database: { status: 'ok', responseMs: 120, errorCode: null },
    jobs: [
      { name: 'sweeper', label: 'Queue sweeper', schedule: 'every 10 seconds', note: null, status: 'failing',
        lastSuccessAt: now, lastFailureAt: now, lastFailureCode: 'ADVANCE_FAILED', detail: {} },
      { name: 'cleanup', label: 'Privacy cleanup', schedule: 'every 60 minutes', note: null, status: 'ok',
        lastSuccessAt: now, lastFailureAt: null, lastFailureCode: null, detail: { anonymized: 3 } },
      { name: 'news', label: 'Local news refresh', schedule: 'every 15 minutes', note: null, status: 'unknown',
        lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, detail: {} },
      { name: 'pinger', label: 'Uptime pinger (cron-job.org)', schedule: 'as set in cron-job.org',
        note: 'Late is normal outside the hours the pinger is set to run.', status: 'late',
        lastSuccessAt: now, lastFailureAt: null, lastFailureCode: null, detail: {} },
    ],
    sockets: 7,
    server: { startedAt: now, uptimeSeconds: 3900, memoryMb: 140, heapUsedMb: 60, nodeVersion: 'v22.23.4', environment: 'production' },
    build: { commit: 'abc1234', branch: 'main' },
    ...over,
  };
}

const renderIt = () => renderPage(<TechPanel />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchTechHealth).mockReset().mockResolvedValue(sample());
});

describe('TechPanel', () => {
  it('shows each job with a written status and the failure code', async () => {
    renderIt();
    const jobs = await screen.findByRole('region', { name: 'Background jobs' });
    expect(within(jobs).getByText('Failing')).toBeInTheDocument();
    expect(within(jobs).getByText(/ADVANCE_FAILED/)).toBeInTheDocument();
    expect(within(jobs).getByText('No report yet')).toBeInTheDocument();
    expect(within(jobs).getByText('anonymized: 3')).toBeInTheDocument();
    expect(within(jobs).getByText(/late is normal outside/i)).toBeInTheDocument();
  });

  it('overall is the worst status, ignoring the pinger', async () => {
    renderIt();
    expect(within(await screen.findByRole('region', { name: 'Overall' })).getByText('Failing')).toBeInTheDocument();
  });

  it('shows database time, connections, version and uptime', async () => {
    renderIt();
    expect(await screen.findByText('Responded in 120 ms.')).toBeInTheDocument();
    expect(screen.getByTestId('sockets')).toHaveTextContent('7');
    expect(screen.getByText('abc1234 (main)')).toBeInTheDocument();
    expect(screen.getByText('1 h 5 min')).toBeInTheDocument();
  });

  it('says so when the server cannot be reached', async () => {
    vi.mocked(admin.fetchTechHealth).mockRejectedValue(new Error('offline'));
    renderIt();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't reach the server/i);
  });

  it('formats "ago" in plain words', () => {
    const t = Date.parse('2026-11-12T10:00:00Z');
    expect(ago(null, t)).toBe('never');
    expect(ago('2026-11-12T09:59:30Z', t)).toBe('30 sec ago');
    expect(ago('2026-11-12T09:55:00Z', t)).toBe('5 min ago');
    expect(ago('2026-11-12T07:00:00Z', t)).toBe('3 h ago');
  });
});
