import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JoinQueue from './JoinQueue';
import { renderPage } from '../test/utils';
import { saveTicket, getTickets } from '../lib/activeTickets';
import { ApiError } from '../api/client';
import * as tickets from '../api/tickets';

vi.mock('../api/tickets', () => ({
  joinSalonQueue: vi.fn(),
  fetchTicketStatus: vi.fn(),
}));

const TOKEN = 'a'.repeat(40);
const renderJoin = () =>
  renderPage(<JoinQueue />, { path: '/salons/:salonId/join', route: '/salons/salon-1/join' });
const seed = (salonId = 'salon-1') =>
  saveTicket({ ticketId: 't1', accessToken: TOKEN, salonId, tokenNumber: 7 });

beforeEach(() => {
  vi.mocked(tickets.joinSalonQueue).mockReset();
  vi.mocked(tickets.fetchTicketStatus).mockReset();
});

describe('JoinQueue', () => {
  it('shows one button and no personal fields', () => {
    renderJoin();
    expect(screen.getByRole('button', { name: 'Get my token' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Your mobile number')).not.toBeInTheDocument();
    expect(screen.getByText(/no account, name or phone number needed/i)).toBeInTheDocument();
  });

  it('joins, saves only ticket identifiers, and moves to the tracking page', async () => {
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue({
      ticketId: 't1',
      accessToken: TOKEN,
      salonId: 'salon-1',
      tokenNumber: 7,
    });
    const user = userEvent.setup();
    renderJoin();

    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    expect(tickets.joinSalonQueue).toHaveBeenCalledWith('salon-1');
    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument(); // navigated away
    const stored = localStorage.getItem('svq.tickets.v1')!;
    expect(getTickets()).toHaveLength(1);
    expect(stored).not.toContain('customer');
  });

  it('shows a server message such as "Queue is paused."', async () => {
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(new ApiError('Queue is paused.', 409));
    const user = userEvent.setup();
    renderJoin();

    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Queue is paused.');
  });

  it('warns about an existing active ticket, offers resume, and allows joining for someone else', async () => {
    seed();
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({
      status: 'WAITING',
      peopleAhead: 2,
      estimatedWaitMinutes: 20,
      tokenNumber: 7,
    });
    const user = userEvent.setup();
    renderJoin();

    expect(await screen.findByText('You already have an active queue ticket.')).toBeInTheDocument();
    expect(screen.getByText(/Token #7/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my ticket' })).toHaveAttribute(
      'href',
      `/tickets/t1?accessToken=${TOKEN}`,
    );

    await user.click(screen.getByRole('button', { name: 'Join for another person' }));
    expect(screen.getByRole('button', { name: 'Get my token' })).toBeInTheDocument();
  });

  it('ignores and cleans up a saved ticket the server says is finished', async () => {
    seed();
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({ status: 'COMPLETED' });
    renderJoin();

    expect(await screen.findByRole('button', { name: 'Get my token' })).toBeInTheDocument();
    await waitFor(() => expect(getTickets()).toHaveLength(0));
  });

  it('does not warn about a ticket at a different salon', () => {
    seed('some-other-salon');
    renderJoin();
    expect(screen.getByRole('button', { name: 'Get my token' })).toBeInTheDocument();
    expect(tickets.fetchTicketStatus).not.toHaveBeenCalled();
  });
});