// frontend/src/pages/QueueTracking.prize.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueueTracking from './QueueTracking';
import { renderPage } from '../test/utils';
import { resetSocket } from '../test/fakeSocket';
import * as tickets from '../api/tickets';
import { setLang } from '../lib/i18n';

// These tests check the English wording; the Hindi default has its own tests.
beforeEach(() => setLang('en'));

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
const PRIZE = { name: 'Head massage', redeemed: false };

const given = (over: Record<string, unknown> = {}) =>
  vi.mocked(tickets.fetchTicketStatus).mockResolvedValue(ticket(over));
const renderTicket = () =>
  renderPage(<QueueTracking />, { path: '/tickets/:ticketId', route: '/tickets/t1?accessToken=secret' });

beforeEach(() => {
  resetSocket();
  vi.mocked(tickets.fetchTicketStatus).mockReset();
});

describe('QueueTracking: surprise reward', () => {
  it('keeps the prize hidden until the customer taps to reveal, and never shows a code', async () => {
    given({ prize: PRIZE });
    const user = userEvent.setup();
    renderTicket();

    expect(await screen.findByText(/you have a surprise reward/i)).toBeInTheDocument();
    expect(screen.queryByText(/Head massage/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /tap to reveal/i }));
    expect(screen.getByText(/Head massage/)).toBeInTheDocument();
    expect(screen.getByText(/once your service starts/i)).toBeInTheDocument();
    expect(screen.queryByText(/your code/i)).not.toBeInTheDocument();
  });

  it('tells a customer who is being served that the barber will give it', async () => {
    given({ status: 'SERVING', prize: PRIZE });
    const user = userEvent.setup();
    renderTicket();

    await user.click(await screen.findByRole('button', { name: /tap to reveal/i }));
    expect(screen.getByText(/will give it to you during your service/i)).toBeInTheDocument();
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
  });

  it('on a completed ticket with an unclaimed prize, asks the customer to tell the barber', async () => {
    given({ status: 'COMPLETED', prize: PRIZE });
    const user = userEvent.setup();
    renderTicket();

    expect(await screen.findByText(/your service is complete/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /tap to reveal/i }));
    expect(screen.getByText(/tell the barber/i)).toBeInTheDocument();
  });
});