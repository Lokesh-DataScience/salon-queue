// frontend/src/pages/ScanLanding.offday.test.tsx — Weekly off day, Slice 2: the wall QR on an off day.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import ScanLanding from './ScanLanding';
import { renderPage } from '../test/utils';
import { resetLangForTests, setLang } from '../lib/i18n';
import { saveRememberToken } from '../lib/rememberToken';
import { saveTicket } from '../lib/activeTickets';
import * as salons from '../api/salons';
import * as tickets from '../api/tickets';
import * as services from '../api/publicServices';
import type { PublicQueue } from '../api/salons';

vi.mock('../api/salons', () => ({ fetchSalonByCode: vi.fn(), fetchSalonLanes: vi.fn(), fetchPublicQueue: vi.fn() }));
vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn(), joinSalonQueue: vi.fn() }));
vi.mock('../api/publicServices', () => ({ fetchSalonServices: vi.fn() }));
vi.mock('../lib/push', () => ({
  askPushPermission: vi.fn().mockResolvedValue('skip'),
  enablePushAfterJoin: vi.fn(),
}));

const queue = (over: Partial<PublicQueue> = {}): PublicQueue => ({
  salonId: 's1', name: 'Style Studio', isOpen: true, isPaused: false, allowAppJoin: true,
  nowServingToken: 0, waitingCount: 0, estimatedWaitMinutes: null, lanes: null, ...over,
});
const OFF_TUESDAY = { isOpen: false, isOffDay: true, weeklyOffDays: [2] };

const renderScan = () => renderPage(<ScanLanding />, { path: '/q/:code', route: '/q/abcdef123456' });

beforeEach(() => {
  localStorage.clear();
  resetLangForTests(); // Hindi by default
  vi.mocked(salons.fetchSalonByCode).mockReset().mockResolvedValue({ id: 's1', name: 'Style Studio' });
  vi.mocked(salons.fetchSalonLanes).mockReset().mockResolvedValue([]);
  vi.mocked(salons.fetchPublicQueue).mockReset().mockResolvedValue(queue());
  vi.mocked(services.fetchSalonServices).mockReset().mockResolvedValue([]);
  vi.mocked(tickets.fetchTicketStatus).mockReset();
  vi.mocked(tickets.joinSalonQueue).mockReset();
});

describe('Scanning on the weekly off day', () => {
  it('a new customer is told the salon is closed today, in Hindi, and is not asked for details', async () => {
    vi.mocked(salons.fetchPublicQueue).mockResolvedValue(queue(OFF_TUESDAY));
    renderScan();

    expect(await screen.findByRole('heading', { name: 'आज सैलून बंद है' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('सैलून हर मंगलवार को बंद रहता है');
    expect(screen.queryByLabelText('आपका नाम')).not.toBeInTheDocument();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();
  });

  it('a known customer is not given a token either, and the message switches to English', async () => {
    saveRememberToken('s1', 'd'.repeat(64));
    setLang('en');
    vi.mocked(salons.fetchPublicQueue).mockResolvedValue(queue({ ...OFF_TUESDAY, weeklyOffDays: [0, 2] }));
    renderScan();

    expect(await screen.findByRole('heading', { name: 'Closed today' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('closed every Tuesday and Sunday');
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();
  });

  it('a ticket this phone already holds still opens on the off day', async () => {
    saveTicket({ ticketId: 't-old', accessToken: 'a'.repeat(40), salonId: 's1', tokenNumber: 4 });
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({ status: 'WAITING' } as never);
    vi.mocked(salons.fetchPublicQueue).mockResolvedValue(queue(OFF_TUESDAY));
    renderScan();

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(tickets.joinSalonQueue).not.toHaveBeenCalled();
  });

  it('a normal day joins as before', async () => {
    saveRememberToken('s1', 'd'.repeat(64));
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue({
      ticketId: 't-new', accessToken: 'a'.repeat(40), salonId: 's1', tokenNumber: 9,
    } as never);
    renderScan();

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
    expect(tickets.joinSalonQueue).toHaveBeenCalledTimes(1);
  });

  it('if the off-day check fails, the scan carries on (the server still decides)', async () => {
    saveRememberToken('s1', 'd'.repeat(64));
    vi.mocked(salons.fetchPublicQueue).mockRejectedValue(new Error('down'));
    vi.mocked(tickets.joinSalonQueue).mockResolvedValue({
      ticketId: 't-new', accessToken: 'a'.repeat(40), salonId: 's1', tokenNumber: 9,
    } as never);
    renderScan();

    expect(await screen.findByText('OTHER PAGE')).toBeInTheDocument();
  });
});
