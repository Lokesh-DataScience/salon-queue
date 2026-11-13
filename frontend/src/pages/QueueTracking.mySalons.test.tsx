// frontend/src/pages/QueueTracking.mySalons.test.tsx
// Bug fix: opening a ticket must add its salon to "My salons", even in a browser (or installed app)
// that never saw the QR scan. Otherwise the app forgets the salon once the ticket is finished.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import QueueTracking from './QueueTracking';
import { renderPage } from '../test/utils';
import { resetSocket } from '../test/fakeSocket';
import { getMySalons } from '../lib/mySalons';
import * as tickets from '../api/tickets';

vi.mock('../lib/socket', () => import('../test/fakeSocket'));
vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn(), leaveTicket: vi.fn() }));
// The ticket page's side panels are not what this test is about.
vi.mock('../components/NotifyMe', () => ({ default: () => null }));
vi.mock('../components/LocalNews', () => ({ default: () => null }));
vi.mock('../components/Countdown', () => ({ default: () => null }));
vi.mock('../components/ForgetMe', () => ({ default: () => null }));
vi.mock('../components/InstallAppBanner', () => ({ default: () => null }));

const base = {
  ticketId: 't-1', salonId: 'salon-1', tokenNumber: 4, currentToken: 2, peopleAhead: 1, movedAhead: false,
  estimatedWaitMinutes: 10, endsAt: null, remainingSeconds: null, durationMinutes: 10, services: [],
  queueStatus: 'ACTIVE', lane: null, notificationsOn: false, prize: null,
};
const renderTicket = () =>
  renderPage(<QueueTracking />, { path: '/tickets/:ticketId', route: `/tickets/t-1?accessToken=${'a'.repeat(40)}` });

beforeEach(() => {
  resetSocket();
  vi.mocked(tickets.fetchTicketStatus).mockReset();
});

describe('QueueTracking adds the salon to "My salons"', () => {
  it('while waiting', async () => {
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({
      ...base, status: 'WAITING', salonName: 'Milan Hair Salon', salonCode: 'abcdef123456',
    });
    renderTicket();
    expect(await screen.findByText('#4')).toBeInTheDocument();
    expect(getMySalons()).toEqual([
      expect.objectContaining({ salonId: 'salon-1', code: 'abcdef123456', name: 'Milan Hair Salon' }),
    ]);
  });

  it('on a finished ticket too (the moment the app needs it most)', async () => {
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({
      ...base, status: 'COMPLETED', salonName: 'Milan Hair Salon', salonCode: 'abcdef123456',
    });
    renderTicket();
    expect(await screen.findByText('Your service is complete. Thank you!')).toBeInTheDocument();
    expect(getMySalons().map((s) => s.code)).toEqual(['abcdef123456']);
  });

  it('an older server without the salon fields: nothing saved, nothing broken', async () => {
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({ ...base, status: 'WAITING' });
    renderTicket();
    expect(await screen.findByText('#4')).toBeInTheDocument();
    expect(getMySalons()).toEqual([]);
  });
});
