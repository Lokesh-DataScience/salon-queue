// frontend/src/pages/JoinQueue.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JoinQueue from './JoinQueue';
import { renderPage } from '../test/utils';
import { getRememberToken, saveRememberToken } from '../lib/rememberToken';
import { getTickets } from '../lib/activeTickets';
import { ApiError } from '../api/client';
import * as tickets from '../api/tickets';
import * as salons from '../api/salons';
import * as active from '../hooks/useActiveTickets';

vi.mock('../api/tickets', () => ({ joinSalonQueue: vi.fn() }));
vi.mock('../api/salons', () => ({ fetchSalonLanes: vi.fn() }));
vi.mock('../hooks/useActiveTickets', () => ({ useActiveTickets: vi.fn() }));

const REMEMBER = 'c'.repeat(64);
const TICKET = { ticketId: 't1', accessToken: 'a'.repeat(64), salonId: 'salon-1', tokenNumber: 5 };
const renderJoin = () => renderPage(<JoinQueue />, { path: '/salons/:salonId/join', route: '/salons/salon-1/join' });

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Your name'), 'Ravi Kumar');
  await user.type(screen.getByLabelText('Mobile number'), '98765 43210');
  await user.click(screen.getByRole('checkbox', { name: /will save my name and number/i }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(tickets.joinSalonQueue).mockReset().mockResolvedValue(TICKET);
  vi.mocked(salons.fetchSalonLanes).mockReset().mockResolvedValue([]);
  vi.mocked(active.useActiveTickets).mockReset().mockReturnValue({ tickets: [], isChecking: false });
});

describe('JoinQueue: first visit to a salon', () => {
  it('asks for details first, and the button stays off until they are complete', async () => {
    const user = userEvent.setup();
    renderJoin();

    const button = await screen.findByRole('button', { name: 'Get my token' });
    expect(button).toBeDisabled();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();

    await fillDetails(user);
    expect(button).toBeEnabled();
  });

  it('joins with the details and consent, keeps only the remember token, and never stores name or phone', async () => {
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue({ ...TICKET, rememberToken: REMEMBER } as never);
    const user = userEvent.setup();
    renderJoin();

    await screen.findByLabelText('Your name');
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    await waitFor(() =>
      expect(tickets.joinSalonQueue).toHaveBeenCalledWith('salon-1', undefined, undefined, undefined, {
        name: 'Ravi Kumar',
        phone: '9876543210',
        consent: true,
        rememberToken: undefined,
      }),
    );
    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(getRememberToken('salon-1')).toBe(REMEMBER);
    expect(getTickets('salon-1')).toHaveLength(1);

    const everything = JSON.stringify({ ...localStorage });
    expect(everything).not.toContain('Ravi');
    expect(everything).not.toContain('9876543210');
  });
});

describe('JoinQueue: a phone the salon already knows', () => {
  beforeEach(() => saveRememberToken('salon-1', REMEMBER));

  it('shows one tap, with no personal fields', async () => {
    renderJoin();
    expect(await screen.findByText(/This salon already knows you/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get my token' })).toBeEnabled();
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mobile number')).not.toBeInTheDocument();
  });

  it('joins with just the remember token', async () => {
    const user = userEvent.setup();
    renderJoin();
    await user.click(await screen.findByRole('button', { name: 'Get my token' }));

    await waitFor(() =>
      expect(tickets.joinSalonQueue).toHaveBeenCalledWith('salon-1', undefined, undefined, undefined, { rememberToken: REMEMBER }),
    );
    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
  });

  it('sends the chosen barber when the salon has several', async () => {
    vi.mocked(salons.fetchSalonLanes).mockResolvedValue([
      { id: 'lane-a', name: 'Owner', waitingCount: 1, estimatedWaitMinutes: 10 },
      { id: 'lane-b', name: 'Rahul', waitingCount: 0, estimatedWaitMinutes: 0 },
    ]);
    const user = userEvent.setup();
    renderJoin();
    await user.click(await screen.findByLabelText(/Rahul/));
    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    await waitFor(() =>
      expect(tickets.joinSalonQueue).toHaveBeenCalledWith('salon-1', undefined, undefined, 'lane-b', { rememberToken: REMEMBER }),
    );
  });

  it('shows the server message when the queue cannot be joined, and stays one tap', async () => {
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(new ApiError('Queue is paused.', 409));
    const user = userEvent.setup();
    renderJoin();
    await user.click(await screen.findByRole('button', { name: 'Get my token' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Queue is paused.');
    expect(getRememberToken('salon-1')).toBe(REMEMBER); // still known to the salon
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });

  it('falls back to the details form when the salon no longer knows this phone', async () => {
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('Please enter your name and number.', 400, undefined, 'CUSTOMER_DETAILS_REQUIRED'),
    );
    const user = userEvent.setup();
    renderJoin();
    await user.click(await screen.findByRole('button', { name: 'Get my token' }));

    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your details again.');
    expect(getRememberToken('salon-1')).toBeNull();
  });
});

describe('JoinQueue: an existing ticket', () => {
  it('offers the ticket instead of a second one, and lets the customer join for another person', async () => {
    vi.mocked(active.useActiveTickets).mockReturnValue({
      tickets: [
        {
          stored: { ticketId: 't0', accessToken: 'z'.repeat(64), salonId: 'salon-1', tokenNumber: 3, savedAt: Date.now() },
          ticket: { peopleAhead: 2 },
        },
      ] as never, // only the fields this page reads
      isChecking: false,
    });
    const user = userEvent.setup();
    renderJoin();

    expect(await screen.findByText(/already have an active queue ticket/i)).toBeInTheDocument();
    expect(screen.getByText(/Token #3 · 2 people ahead/)).toBeInTheDocument();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Join for another person' }));
    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
  });
});