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
  it('shows a labelled form asking only for name and mobile number', () => {
    renderJoin();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Your mobile number')).toBeInTheDocument();
    expect(screen.getByText(/no account required/i)).toBeInTheDocument();
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

    await user.type(screen.getByLabelText('Your name'), '  Asha ');
    await user.type(screen.getByLabelText('Your mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    expect(tickets.joinSalonQueue).toHaveBeenCalledWith('salon-1', 'Asha', '9876543210'); // trimmed
    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument(); // navigated away
    const stored = localStorage.getItem('svq.tickets.v1')!;
    expect(getTickets()).toHaveLength(1);
    expect(stored).not.toContain('Asha');
    expect(stored).not.toContain('9876543210');
  });

  it('shows field-specific errors from the server', async () => {
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('Invalid request.', 400, { phone: ['Enter a valid mobile number'] }),
    );
    const user = userEvent.setup();
    renderJoin();

    await user.type(screen.getByLabelText('Your name'), 'Asha');
    await user.type(screen.getByLabelText('Your mobile number'), '123');
    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    expect(await screen.findByText('Enter a valid mobile number')).toBeInTheDocument();
    expect(screen.getByLabelText('Your mobile number')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a server message such as "Queue is paused."', async () => {
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(new ApiError('Queue is paused.', 409));
    const user = userEvent.setup();
    renderJoin();

    await user.type(screen.getByLabelText('Your name'), 'Asha');
    await user.type(screen.getByLabelText('Your mobile number'), '9876543210');
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
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
  });

  it('ignores and cleans up a saved ticket the server says is finished', async () => {
    seed();
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({ status: 'COMPLETED' });
    renderJoin();

    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    await waitFor(() => expect(getTickets()).toHaveLength(0));
  });

  it('does not warn about a ticket at a different salon', () => {
    seed('some-other-salon');
    renderJoin();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(tickets.fetchTicketStatus).not.toHaveBeenCalled();
  });
});