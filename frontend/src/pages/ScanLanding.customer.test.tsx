// frontend/src/pages/ScanLanding.customer.test.tsx
// The first visit to a salon: details once, then the salon remembers this phone.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanLanding from './ScanLanding';
import { renderPage } from '../test/utils';
import { getRememberToken, saveRememberToken } from '../lib/rememberToken';
import { getTickets } from '../lib/activeTickets';
import { ApiError } from '../api/client';
import * as salons from '../api/salons';
import * as tickets from '../api/tickets';
import * as services from '../api/publicServices';
import { setLang } from '../lib/i18n';

// These tests check the English wording; the Hindi default has its own tests.
beforeEach(() => setLang('en'));

vi.mock('../api/salons', () => ({ fetchSalonByCode: vi.fn(), fetchSalonLanes: vi.fn() }));
vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn(), joinSalonQueue: vi.fn() }));
vi.mock('../api/publicServices', () => ({ fetchSalonServices: vi.fn() }));
vi.mock('../lib/push', () => ({
  askPushPermission: vi.fn().mockResolvedValue('denied'),
  enablePushAfterJoin: vi.fn(),
}));

const REMEMBER = 'd'.repeat(64);
const FRESH = 'e'.repeat(64);
const TICKET = { ticketId: 't1', accessToken: 'a'.repeat(64), salonId: 's1', tokenNumber: 4 };
const DETAILS = { name: 'Ravi Kumar', phone: '9876543210', consent: true };
const renderScan = (code = 'ABC123') => renderPage(<ScanLanding />, { path: '/q/:code', route: `/q/${code}` });

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Your name'), 'Ravi Kumar');
  await user.type(screen.getByLabelText('Mobile number'), '9876543210');
  await user.click(screen.getByRole('checkbox', { name: /will save my name and number/i }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(salons.fetchSalonByCode).mockReset().mockResolvedValue({ id: 's1', name: 'Style Studio' });
  vi.mocked(salons.fetchSalonLanes).mockReset().mockResolvedValue([]);
  vi.mocked(services.fetchSalonServices).mockReset().mockResolvedValue([]);
  vi.mocked(tickets.fetchTicketStatus).mockReset();
  vi.mocked(tickets.joinSalonQueue).mockReset().mockResolvedValue(TICKET);
});

describe('ScanLanding: first visit', () => {
  it('shows the details form and takes no token until it is filled in', async () => {
    renderScan();
    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get my token' })).toBeDisabled();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();
  });

  it('joins with the details and consent, and saves the remember token the server returns', async () => {
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue({ ...TICKET, rememberToken: REMEMBER } as never);
    const user = userEvent.setup();
    renderScan();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(tickets.joinSalonQueue).toHaveBeenCalledTimes(1);
    expect(tickets.joinSalonQueue).toHaveBeenCalledWith('s1', expect.any(String), [], undefined, {
      ...DETAILS,
      rememberToken: undefined,
    });
    expect(getRememberToken('s1')).toBe(REMEMBER);
    expect(getTickets('s1')).toHaveLength(1);
  });

  it('never writes the name or the number to browser storage', async () => {
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue({ ...TICKET, rememberToken: REMEMBER } as never);
    const user = userEvent.setup();
    renderScan();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Get my token' }));
    await screen.findByText('OTHER PAGE');

    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain('Ravi');
    expect(stored).not.toContain('9876543210');
  });

  it('a salon with services: details, then Continue, then the picker, then one join with everything', async () => {
    vi.mocked(services.fetchSalonServices).mockResolvedValue([{ id: 'c1', name: 'Haircut', durationMinutes: 20 }]);
    const user = userEvent.setup();
    renderScan();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('checkbox', { name: /haircut/i }));
    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    await waitFor(() =>
      expect(tickets.joinSalonQueue).toHaveBeenCalledWith('s1', expect.any(String), ['c1'], undefined, {
        ...DETAILS,
        rememberToken: undefined,
      }),
    );
  });

  it('shows the form again with the server message when consent is refused', async () => {
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('Please tick the box to continue.', 400, undefined, 'CONSENT_REQUIRED'),
    );
    const user = userEvent.setup();
    renderScan();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please tick the box to continue.');
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(getTickets('s1')).toHaveLength(0);
  });
});

describe('ScanLanding: the salon already knows this phone', () => {
  it('skips the form and joins with only the remember token', async () => {
    saveRememberToken('s1', REMEMBER);
    renderScan();

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    expect(tickets.joinSalonQueue).toHaveBeenCalledWith('s1', expect.any(String), [], undefined, { rememberToken: REMEMBER });
  });

  it('keeps a token it was not given a new one for, and replaces it when the server issues one', async () => {
    saveRememberToken('s1', REMEMBER);
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue({ ...TICKET, rememberToken: FRESH } as never);
    renderScan();
    await screen.findByText('OTHER PAGE');
    expect(getRememberToken('s1')).toBe(FRESH);
  });

  it("a different salon still asks, because the token belongs to one salon only", async () => {
    saveRememberToken('s1', REMEMBER);
    vi.mocked(salons.fetchSalonByCode).mockResolvedValue({ id: 's2', name: 'Other Salon' });
    renderScan('XYZ999');

    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();
  });

  it('forgets a token the salon no longer knows and asks again, with a note', async () => {
    saveRememberToken('s1', REMEMBER);
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('Please enter your name and number.', 400, undefined, 'CUSTOMER_DETAILS_REQUIRED'),
    );
    renderScan();

    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Please enter your details again.');
    expect(getRememberToken('s1')).toBeNull();
  });

  it('stale token on the picker path: the tap sends the customer back to the form', async () => {
    saveRememberToken('s1', REMEMBER);
    vi.mocked(services.fetchSalonServices).mockResolvedValue([{ id: 'c1', name: 'Haircut', durationMinutes: 20 }]);
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('Please enter your name and number.', 400, undefined, 'CUSTOMER_DETAILS_REQUIRED'),
    );
    const user = userEvent.setup();
    renderScan();
    await user.click(await screen.findByRole('checkbox', { name: /haircut/i }));
    await user.click(screen.getByRole('button', { name: 'Get my token' }));

    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Please enter your details again.');
    expect(getRememberToken('s1')).toBeNull();
  });
});