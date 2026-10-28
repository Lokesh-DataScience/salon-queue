// frontend/src/pages/QueueTracking.prize.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueueTracking from './QueueTracking';
import { renderPage } from '../test/utils';
import { resetSocket } from '../test/fakeSocket';
import * as tickets from '../api/tickets';

vi.mock('../lib/socket', () => import('../test/fakeSocket'));
vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn(), leaveTicket: vi.fn() }));
vi.mock('../components/NotifyMe', () => ({ default: () => null }));

const ticket = (over: Record<string, unknown> = {}) => ({
  ticketId: 't1',
  salonId: 'salon-1',
  tokenNumber: 7,
  status: 'WAITING',
  currentToken: 3,
  peopleAhead: 3,
  estimatedWaitMinutes: 45,
  queueStatus: 'ACTIVE',
  notificationsOn: false,
  prize: null,
  ...over,
});
const PRIZE = { name: 'Head massage', code: 'K7M2QX', redeemed: false };

const given = (over: Record<string, unknown> = {}) =>
  vi.mocked(tickets.fetchTicketStatus).mockResolvedValue(ticket(over));
const renderTicket = () =>
  renderPage(<QueueTracking />, { path: '/tickets/:ticketId', route: '/tickets/t1?accessToken=secret' });

beforeEach(() => {
  resetSocket();
  vi.mocked(tickets.fetchTicketStatus).mockReset();
});

describe('QueueTracking: surprise reward', () => {
  it('keeps the prize and code hidden until the customer taps to reveal', async () => {
    given({ prize: PRIZE });
    const user = userEvent.setup();
    renderTicket();

    expect(await screen.findByText(/you have a surprise reward/i)).toBeInTheDocument();
    expect(screen.queryByText('K7M2QX')).not.toBeInTheDocument();
    expect(screen.queryByText(/Head massage/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /tap to reveal/i }));
    expect(screen.getByText('K7M2QX')).toBeInTheDocument();
    expect(screen.getByText(/Head massage/)).toBeInTheDocument();
    expect(screen.getByText(/once your service starts/i)).toBeInTheDocument();
  });

  it('tells a customer who is being served to show the code now', async () => {
    given({ status: 'SERVING', prize: PRIZE });
    const user = userEvent.setup();
    renderTicket();

    await user.click(await screen.findByRole('button', { name: /tap to reveal/i }));
    expect(screen.getByText(/show this code to the barber now/i)).toBeInTheDocument();
  });

  it('shows no reward section when there is no prize', async () => {
    given();
    renderTicket();
    await screen.findByText('Your token');
    expect(screen.queryByRole('region', { name: 'Your reward' })).not.toBeInTheDocument();
  });

  it('shows "Reward claimed" once it has been redeemed', async () => {
    given({ status: 'SERVING', prize: { ...PRIZE, redeemed: true } });
    renderTicket();

    expect(await screen.findByText('Reward claimed')).toBeInTheDocument();
    expect(screen.queryByText('K7M2QX')).not.toBeInTheDocument();
  });

  it('still offers the code on a completed ticket so it is not lost', async () => {
    given({ status: 'COMPLETED', prize: PRIZE });
    const user = userEvent.setup();
    renderTicket();

    expect(await screen.findByText(/your service is complete/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /tap to reveal/i }));
    expect(screen.getByText('K7M2QX')).toBeInTheDocument();
  });
});