import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanLanding from './ScanLanding';
import { renderPage } from '../test/utils';
import { saveTicket, getTickets } from '../lib/activeTickets';
import { ApiError } from '../api/client';
import * as tickets from '../api/tickets';
import * as salons from '../api/salons';

vi.mock('../api/tickets', () => ({
  joinSalonQueue: vi.fn(),
  fetchTicketStatus: vi.fn(),
}));
vi.mock('../api/salons', () => ({
  fetchSalonByCode: vi.fn(),
}));

const TOKEN = 'a'.repeat(40);
const newTicket = { ticketId: 't-new', accessToken: TOKEN, salonId: 'salon-1', tokenNumber: 9 };
const renderScan = (ui = <ScanLanding />) =>
  renderPage(ui, { path: '/q/:code', route: '/q/87bcee043619' });

beforeEach(() => {
  vi.mocked(tickets.joinSalonQueue).mockReset();
  vi.mocked(tickets.fetchTicketStatus).mockReset();
  vi.mocked(salons.fetchSalonByCode).mockReset();
  vi.mocked(salons.fetchSalonByCode).mockResolvedValue({ id: 'salon-1', name: 'Milan Hair Salon' });
});

describe('ScanLanding (wall QR)', () => {
  it('takes a token on scan, saves only ticket identifiers, and leaves for the ticket page', async () => {
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue(newTicket);
    renderScan();

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(salons.fetchSalonByCode).toHaveBeenCalledWith('87bcee043619');
    expect(tickets.joinSalonQueue).toHaveBeenCalledWith('salon-1');
    const stored = getTickets('salon-1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ ticketId: 't-new', tokenNumber: 9, salonId: 'salon-1' });
    expect(Object.keys(stored[0]).sort()).toEqual(['accessToken', 'salonId', 'savedAt', 'ticketId', 'tokenNumber']);
  });

  it('never takes two tokens, even when React runs the effect twice (StrictMode)', async () => {
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue(newTicket);
    renderScan(
      <StrictMode>
        <ScanLanding />
      </StrictMode>,
    );
    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(tickets.joinSalonQueue).toHaveBeenCalledTimes(1);
  });

  it('scanning again resumes the ticket this phone already has instead of taking another', async () => {
    saveTicket({ ticketId: 't-old', accessToken: TOKEN, salonId: 'salon-1', tokenNumber: 4 });
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({ status: 'WAITING' });
    renderScan();

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();
    expect(getTickets('salon-1').map((t) => t.ticketId)).toEqual(['t-old']);
  });

  it('a finished old ticket is forgotten and a fresh token is taken', async () => {
    saveTicket({ ticketId: 't-old', accessToken: TOKEN, salonId: 'salon-1', tokenNumber: 4 });
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({ status: 'COMPLETED' });
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue(newTicket);
    renderScan();

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(tickets.joinSalonQueue).toHaveBeenCalledTimes(1);
    expect(getTickets('salon-1').map((t) => t.ticketId)).toEqual(['t-new']);
  });

  it("a ticket from a different salon doesn't block a new token here", async () => {
    saveTicket({ ticketId: 't-other', accessToken: TOKEN, salonId: 'salon-2', tokenNumber: 2 });
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue(newTicket);
    renderScan();

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(tickets.fetchTicketStatus).not.toHaveBeenCalled();
    expect(tickets.joinSalonQueue).toHaveBeenCalledTimes(1);
  });

  it('shows a clear message for an unknown QR code and takes no token', async () => {
    vi.mocked(salons.fetchSalonByCode).mockRejectedValue(new ApiError('This QR code is not recognised.', 404));
    renderScan();

    expect(await screen.findByText('QR code not recognised')).toBeInTheDocument();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows the salon name and the reason when the queue cannot be joined (closed / paused)', async () => {
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(new ApiError('Queue is paused.', 409));
    renderScan();

    expect(await screen.findByText("Can't get a token right now")).toBeInTheDocument();
    expect(screen.getByText('Milan Hair Salon')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Queue is paused.');
    expect(getTickets()).toHaveLength(0);
  });

  it('offers Try again after a network failure, and then succeeds', async () => {
    vi.mocked(salons.fetchSalonByCode)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ id: 'salon-1', name: 'Milan Hair Salon' });
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue(newTicket);
    renderScan();

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('OTHER PAGE')).toBeInTheDocument());
    expect(tickets.joinSalonQueue).toHaveBeenCalledTimes(1);
  });
});
