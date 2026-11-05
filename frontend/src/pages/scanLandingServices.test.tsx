// frontend/src/pages/scanLandingServices.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanLanding from './ScanLanding';
import { renderPage } from '../test/utils';
import * as salons from '../api/salons';
import * as tickets from '../api/tickets';
import * as services from '../api/publicServices';

vi.mock('../api/salons', () => ({ fetchSalonByCode: vi.fn() }));
vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn(), joinSalonQueue: vi.fn() }));
vi.mock('../api/publicServices', () => ({ fetchSalonServices: vi.fn() }));
vi.mock('../lib/push', () => ({
  askPushPermission: vi.fn().mockResolvedValue('skip'),
  enablePushAfterJoin: vi.fn(),
}));

const SALON = { id: 's1', name: 'Style Studio' };
const CUT = { id: 'c1', name: 'Haircut', durationMinutes: 20 };
const BEARD = { id: 'b1', name: 'Beard', durationMinutes: 10 };
const TICKET = { ticketId: 't1', accessToken: 'a'.repeat(40), salonId: 's1', tokenNumber: 1 };
const renderScan = () => renderPage(<ScanLanding />, { path: '/q/:code', route: '/q/ABC123' });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(salons.fetchSalonByCode).mockReset().mockResolvedValue(SALON as never);
  vi.mocked(tickets.fetchTicketStatus).mockReset();
  vi.mocked(tickets.joinSalonQueue).mockReset().mockResolvedValue(TICKET);
  vi.mocked(services.fetchSalonServices).mockReset().mockResolvedValue([CUT, BEARD]);
});

describe('ScanLanding with services', () => {
  it('shows the picker and takes no token until the customer taps', async () => {
    renderScan();
    expect(await screen.findByRole('checkbox', { name: /haircut/i })).toBeInTheDocument();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();
  });

  it('joins with the chosen services and shows the running total', async () => {
    const user = userEvent.setup();
    renderScan();

    await user.click(await screen.findByRole('checkbox', { name: /haircut/i }));
    await user.click(screen.getByRole('checkbox', { name: /beard/i }));
    expect(screen.getByText(/2 services · about 30 min/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Get my token' }));
    await waitFor(() =>
      expect(tickets.joinSalonQueue).toHaveBeenCalledWith('s1', expect.any(String), ['c1', 'b1']),
    );
  });

  it('asks before joining with nothing chosen, and Back changes nothing', async () => {
    const user = userEvent.setup();
    renderScan();

    await user.click(await screen.findByRole('button', { name: 'Get my token' }));
    expect(screen.getByText(/haven't chosen a service/i)).toBeInTheDocument();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Get my token' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(tickets.joinSalonQueue).toHaveBeenCalledWith('s1', expect.any(String), []));
  });

  it('a salon with no services joins straight away, no picker', async () => {
    vi.mocked(services.fetchSalonServices).mockResolvedValue([]);
    renderScan();
    await waitFor(() => expect(tickets.joinSalonQueue).toHaveBeenCalledWith('s1', expect.any(String), []));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the error and keeps the picker when the join is refused', async () => {
    const { ApiError } = await import('../api/client');
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(new ApiError('Queue is paused.', 409));
    const user = userEvent.setup();
    renderScan();

    await user.click(await screen.findByRole('checkbox', { name: /haircut/i }));
    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    expect(await screen.findByText('Queue is paused.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /haircut/i })).toBeInTheDocument();
  });
});