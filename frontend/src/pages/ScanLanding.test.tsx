// frontend/src/pages/ScanLanding.test.tsx
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanLanding from './ScanLanding';
import { renderPage } from '../test/utils';
import { saveTicket, getTickets } from '../lib/activeTickets';
import { saveRememberToken } from '../lib/rememberToken';
import { getMySalons } from '../lib/mySalons';
import { ApiError } from '../api/client';
import * as tickets from '../api/tickets';
import * as salons from '../api/salons';
import { setLang } from '../lib/i18n';

// These tests check the English wording; the Hindi default has its own tests.
beforeEach(() => setLang('en'));

vi.mock('../api/tickets', () => ({
  joinSalonQueue: vi.fn(),
  fetchTicketStatus: vi.fn(),
}));
vi.mock('../api/salons', () => ({
  fetchSalonByCode: vi.fn(),
}));
vi.mock('../api/publicServices', () => ({ 
  fetchSalonServices: vi.fn().mockResolvedValue([]) 
}));
const TOKEN = 'a'.repeat(40);
const REMEMBER = 'b'.repeat(64);
const newTicket = { ticketId: 't-new', accessToken: TOKEN, salonId: 'salon-1', tokenNumber: 9 };
const renderScan = (ui = <ScanLanding />) =>
  renderPage(ui, { path: '/q/:code', route: '/q/87bcee043619' });

beforeEach(() => {
  localStorage.clear();
  // These tests are about the scan itself, so this phone is already known to the salon.
  // The first-visit details form is covered in ScanLanding.customer.test.tsx.
  saveRememberToken('salon-1', REMEMBER);
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
    expect(tickets.joinSalonQueue).toHaveBeenCalledWith('salon-1', expect.any(String), [], undefined, {
      rememberToken: REMEMBER,
    });
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

  // ── Customer app Slice 3 ──
  it('remembers the scanned salon for the customer app (salon details only)', async () => {
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue(newTicket);
    renderScan();
    await screen.findByText('OTHER PAGE');
    expect(getMySalons()).toEqual([
      expect.objectContaining({ salonId: 'salon-1', code: '87bcee043619', name: 'Milan Hair Salon' }),
    ]);
  });

  it('from the customer app, the join is marked as an app join', async () => {
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue(newTicket);
    renderScan(<ScanLanding source="app" />);
    await screen.findByText('OTHER PAGE');
    expect(tickets.joinSalonQueue).toHaveBeenCalledWith('salon-1', expect.any(String), [], undefined, {
      rememberToken: REMEMBER,
      source: 'app',
    });
  });

  it('from the customer app, a switched-off salon is explained in Hindi', async () => {
    setLang('hi');
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('This salon is not taking tokens from the app right now.', 403, undefined, 'APP_JOIN_DISABLED'),
    );
    renderScan(<ScanLanding source="app" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('इस सैलून में अभी ऐप से टोकन बंद है');
  });

  it('from the customer app, "already in the queue" is explained in Hindi', async () => {
    setLang('hi');
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('You already have a token at this salon today.', 409, undefined, 'ALREADY_IN_QUEUE'),
    );
    renderScan(<ScanLanding source="app" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('आपका टोकन पहले से है');
  });

  it('the wall QR keeps the server message', async () => {
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('You already have a token at this salon today.', 409, undefined, 'ALREADY_IN_QUEUE'),
    );
    renderScan();
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have a token at this salon today.');
  });
});
