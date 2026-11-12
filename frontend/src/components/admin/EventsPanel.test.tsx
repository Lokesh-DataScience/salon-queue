// frontend/src/components/admin/EventsPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventsPanel from './EventsPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { EventSummary } from '../../api/admin';

vi.mock('../../api/admin', () => ({ fetchTechEvents: vi.fn() }));

const now = new Date().toISOString();
const summary: EventSummary = {
  days: 1,
  total: 9,
  truncated: false,
  auth: [
    { kind: 'auth', code: 'REFRESH_REUSED', route: null, count: 6, lastAt: now, accounts: 2 },
    { kind: 'auth', code: 'LOGIN_FAILED', route: null, count: 1, lastAt: now, accounts: 0 },
  ],
  errors: [{ kind: 'error', code: 'Error:XX001', route: 'GET /api/barber/queue', count: 1, lastAt: now, accounts: 0 }],
  rateLimits: [],
  recent: [],
};

const renderIt = () => renderPage(<EventsPanel />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchTechEvents).mockReset().mockResolvedValue(summary);
});

describe('EventsPanel', () => {
  it('explains sign-in problems in plain words, with counts and accounts', async () => {
    renderIt();
    const auth = await screen.findByRole('region', { name: 'Sign-in problems' });
    expect(within(auth).getByText('REFRESH_REUSED')).toBeInTheDocument();
    expect(within(auth).getByText('× 6')).toBeInTheDocument();
    expect(within(auth).getByText('(2 accounts)')).toBeInTheDocument();
    expect(within(auth).getByText(/used twice/i)).toBeInTheDocument();
  });

  it('shows server errors with their route, and an empty message for rate limits', async () => {
    renderIt();
    const errors = await screen.findByRole('region', { name: 'Server errors' });
    expect(within(errors).getByText('GET /api/barber/queue')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Rate limits hit' })).getByText('No rate limits hit.')).toBeInTheDocument();
  });

  it('switches to the last 7 days', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('region', { name: 'Sign-in problems' });
    await user.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(admin.fetchTechEvents).toHaveBeenLastCalledWith(7);
  });
});
