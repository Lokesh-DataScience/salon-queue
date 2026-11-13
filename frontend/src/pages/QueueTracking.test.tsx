// frontend/src/pages/queueTracking.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueueTracking from './QueueTracking';
import { renderPage } from '../test/utils';
import { socket, fireSocket, resetSocket } from '../test/fakeSocket';
import { saveTicket, getTickets } from '../lib/activeTickets';
import * as tickets from '../api/tickets';
import * as push from '../lib/push';
import * as feed from '../api/feed';
import { setLang } from '../lib/i18n';

// These tests check the English wording; the Hindi default has its own tests.
beforeEach(() => setLang('en'));

vi.mock('../lib/socket', () => import('../test/fakeSocket'));
vi.mock('../api/tickets', () => ({
  fetchTicketStatus: vi.fn(),
  leaveTicket: vi.fn(),
}));
vi.mock('../lib/push', () => ({
  fetchPushConfig: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  pushSupport: vi.fn(),
}));
vi.mock('../api/feed', () => ({ fetchSalonFeed: vi.fn(), reverseGeocode: vi.fn() }));

const TOKEN = 'a'.repeat(40);
const base = {
  ticketId: 't1',
  salonId: 'salon-1',
  tokenNumber: 7,
  status: 'WAITING',
  currentToken: 4,
  peopleAhead: 3,
  estimatedWaitMinutes: 30,
  queueStatus: 'ACTIVE',
  services: [],
  durationMinutes: 10,
  remainingSeconds: null,
};
const given = (overrides: Record<string, unknown> = {}) =>
  vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({ ...base, ...overrides });
const renderTracking = (route = `/tickets/t1?accessToken=${TOKEN}`) =>
  renderPage(<QueueTracking />, { path: '/tickets/:ticketId', route });

beforeEach(() => {
  resetSocket();
  vi.mocked(tickets.fetchTicketStatus).mockReset();
  vi.mocked(tickets.leaveTicket).mockReset();
  vi.mocked(push.fetchPushConfig).mockReset().mockResolvedValue({ enabled: false, publicKey: null });
  vi.mocked(push.pushSupport).mockReset().mockReturnValue('ok');
  vi.mocked(feed.fetchSalonFeed).mockReset().mockResolvedValue([]);
});

describe('QueueTracking: waiting', () => {
  it('shows token, position and estimated wait, and joins the salon room', async () => {
    given();
    renderTracking();

    expect(await screen.findByText('#7')).toBeInTheDocument();
    expect(screen.getByText('3 people ahead')).toBeInTheDocument();
    expect(screen.getByText(/Estimated wait: ~30 min/)).toBeInTheDocument();
    await waitFor(() => expect(socket.emit).toHaveBeenCalledWith('join:salon', { salonId: 'salon-1' }));
  });

  it.each([
    [{ peopleAhead: 1 }, "You're getting close"],
    [{ peopleAhead: 0 }, "You're next"],
    [{ status: 'CALLED', peopleAhead: 0 }, "It's your turn"],
    [{ status: 'SERVING', peopleAhead: 0 }, "It's your turn"],
  ])('status banner for %j is "%s"', async (overrides, banner) => {
    given(overrides);
    renderTracking();
    expect(await screen.findByText(banner)).toBeInTheDocument();
  });

  it('says so when the salon has paused the queue', async () => {
    given({ queueStatus: 'PAUSED' });
    renderTracking();
    expect(await screen.findByText(/paused the queue/i)).toBeInTheDocument();
  });

  it('updates live from a queue:updated broadcast, no refresh needed', async () => {
    given();
    renderTracking();
    await screen.findByText('3 people ahead');

    given({ peopleAhead: 1, estimatedWaitMinutes: 10 }); // what the server will say on the refetch
    act(() => {
      fireSocket('queue:updated', {
        salonId: 'salon-1',
        currentToken: 5,
        queueStatus: 'ACTIVE',
        averageServiceMinutes: 10,
        entries: [
          { id: 'x', tokenNumber: 6, status: 'WAITING' },
          { id: 't1', tokenNumber: 7, status: 'WAITING' },
        ],
      });
    });

    expect(await screen.findByText('1 person ahead')).toBeInTheDocument();
    expect(await screen.findByText(/Estimated wait: ~10 min/)).toBeInTheDocument();
    expect(screen.getByText("You're getting close")).toBeInTheDocument();
  });
    it('offers notifications, and keeps the "keep this page open" line until they are on', async () => {
    vi.mocked(push.fetchPushConfig).mockResolvedValue({ enabled: true, publicKey: 'KEY' });
    given();
    renderTracking();

    expect(await screen.findByRole('button', { name: /notify me/i })).toBeInTheDocument();
    expect(screen.getByText(/keep this page open/i)).toBeInTheDocument();
  });

  it('once notifications are on, says the page can be closed', async () => {
    vi.mocked(push.fetchPushConfig).mockResolvedValue({ enabled: true, publicKey: 'KEY' });
    given({ notificationsOn: true });
    renderTracking();

    expect(await screen.findByText('Notifications are on')).toBeInTheDocument();
    expect(screen.queryByText(/keep this page open/i)).not.toBeInTheDocument();
  });
});

describe('QueueTracking: finished and missing tickets', () => {
  it.each([
    ['COMPLETED', 'Your service is complete. Thank you!'],
    ['SKIPPED', /skipped your turn/],
    ['CANCELLED', 'You left the queue.'],
  ])('%s shows its own message and forgets the saved ticket', async (status, message) => {
    saveTicket({ ticketId: 't1', accessToken: TOKEN, salonId: 'salon-1', tokenNumber: 7 });
    given({ status });
    renderTracking();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toBeInTheDocument();
    await waitFor(() => expect(getTickets()).toHaveLength(0));
  });

  it('a link without an access token shows the friendly error and asks the API nothing', () => {
    renderTracking('/tickets/t1');
    expect(screen.getByText(/couldn't find this queue ticket/i)).toBeInTheDocument();
    expect(tickets.fetchTicketStatus).not.toHaveBeenCalled();
  });
});

describe('QueueTracking: leaving', () => {
  it('asks for confirmation, then leaves', async () => {
    given();
    vi.mocked(tickets.leaveTicket).mockResolvedValue({ ticketId: 't1', status: 'CANCELLED' });
    const user = userEvent.setup();
    renderTracking();

    await user.click(await screen.findByRole('button', { name: 'Leave queue' }));
    expect(screen.getByText(/you will lose your place/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, leave' }));

    expect(tickets.leaveTicket).toHaveBeenCalledWith('t1', TOKEN);
    expect(await screen.findByText('You left the queue.')).toBeInTheDocument();
  });

  it('"Stay" closes the confirmation without leaving', async () => {
    given();
    const user = userEvent.setup();
    renderTracking();

    await user.click(await screen.findByRole('button', { name: 'Leave queue' }));
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('button', { name: 'Leave queue' })).toBeInTheDocument();
    expect(tickets.leaveTicket).not.toHaveBeenCalled();
  });

  it('offers no leave button once the customer has been called', async () => {
    given({ status: 'CALLED', peopleAhead: 0 });
    renderTracking();
    await screen.findByText("It's your turn");
    expect(screen.queryByRole('button', { name: 'Leave queue' })).not.toBeInTheDocument();
  });
});
describe('QueueTracking: local news', () => {
  const item = {
    kind: 'news' as const, scope: 'district' as const, title: 'कोरबा में बिजली कटौती',
    url: 'https://example.test/a', source: 'Example', publishedAt: null,
  };

  it('shows headlines as plain links that open the publisher in a new tab', async () => {
    given();
    vi.mocked(feed.fetchSalonFeed).mockResolvedValue([item]);
    renderTracking();

    const link = await screen.findByRole('link', { name: /कोरबा में बिजली कटौती/ });
    expect(link).toHaveAttribute('href', 'https://example.test/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(feed.fetchSalonFeed).toHaveBeenCalledWith('salon-1');
  });

  it('renders nothing when the feed fails or is empty', async () => {
    given();
    vi.mocked(feed.fetchSalonFeed).mockRejectedValue(new Error('down'));
    renderTracking();
    await screen.findByText('#7');
    expect(screen.queryByText('While you wait')).not.toBeInTheDocument();
  });

  it('is not shown once the ticket is finished', async () => {
    given({ status: 'COMPLETED' });
    renderTracking();
    await screen.findByText('Your service is complete. Thank you!');
    expect(feed.fetchSalonFeed).not.toHaveBeenCalled();
  });
});

describe('QueueTracking: services and countdown', () => {
  it('lists the chosen services and the total time', async () => {
    given({
      services: [
        { name: 'Haircut', durationMinutes: 20 },
        { name: 'Beard', durationMinutes: 10 },
      ],
      durationMinutes: 30,
    });
    renderTracking();

    expect(await screen.findByText('Haircut')).toBeInTheDocument();
    expect(screen.getByText('Beard')).toBeInTheDocument();
    expect(screen.getByText(/Total time: ~30 min/)).toBeInTheDocument();
  });

  it('counts down the service time once it is the customer\'s turn, and hides the wait rows', async () => {
    given({ status: 'SERVING', peopleAhead: 0, remainingSeconds: 125 });
    renderTracking();

    expect(await screen.findByRole('timer')).toHaveTextContent(/2:0[45]/);
    expect(screen.queryByText(/people ahead|person ahead/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimated wait/)).not.toBeInTheDocument();
  });
});