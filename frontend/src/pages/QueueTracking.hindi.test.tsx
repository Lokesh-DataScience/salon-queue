// frontend/src/pages/QueueTracking.hindi.test.tsx
// Customer app polish 3a: the ticket page speaks Hindi by default, switches to English,
// shares on WhatsApp without the secret ticket link, and alerts full-screen when called.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueueTracking from './QueueTracking';
import { renderPage } from '../test/utils';
import { fireSocket, resetSocket } from '../test/fakeSocket';
import { resetLangForTests } from '../lib/i18n';
import * as tickets from '../api/tickets';

vi.mock('../lib/socket', () => import('../test/fakeSocket'));
vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn(), leaveTicket: vi.fn() }));
vi.mock('../components/NotifyMe', () => ({ default: () => null }));
vi.mock('../components/LocalNews', () => ({ default: () => null }));
vi.mock('../components/InstallAppBanner', () => ({ default: () => null }));
vi.mock('../components/ForgetMe', () => ({ default: () => null }));
vi.mock('../api/ratings', () => ({
  fetchMyRating: vi.fn().mockResolvedValue({ stars: null, canRate: true }),
  rateVisit: vi.fn(),
}));

const TOKEN = 'a'.repeat(40);
const base = {
  ticketId: 't1',
  salonId: 'salon-1',
  salonName: 'Milan Hair Salon',
  salonCode: 'abcdef123456',
  tokenNumber: 7,
  status: 'WAITING',
  currentToken: 4,
  peopleAhead: 3,
  estimatedWaitMinutes: 30,
  queueStatus: 'ACTIVE',
  services: [],
  durationMinutes: 10,
  remainingSeconds: null,
  notificationsOn: false,
  prize: null,
};
const given = (over: Record<string, unknown> = {}) =>
  vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({ ...base, ...over });
const renderTicket = (id = 't1') =>
  renderPage(<QueueTracking />, { path: '/tickets/:ticketId', route: `/tickets/${id}?accessToken=${TOKEN}` });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetLangForTests();
  resetSocket();
  vi.mocked(tickets.fetchTicketStatus).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('QueueTracking in Hindi (default)', () => {
  it('shows the ticket in Hindi', async () => {
    given();
    renderTicket();
    expect(await screen.findByText('#7')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'मेरा टोकन' })).toBeInTheDocument();
    expect(screen.getByText('Milan Hair Salon')).toBeInTheDocument();
    expect(screen.getByText('आपका टोकन')).toBeInTheDocument();
    expect(screen.getByText('आपसे पहले 3 लोग')).toBeInTheDocument();
    expect(screen.getByText('अनुमानित इंतज़ार: ~30 मिनट')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /लाइन छोड़ें/ })).toBeInTheDocument();
  });

  it.each([
    [{ peopleAhead: 1 }, 'आपकी बारी करीब है'],
    [{ peopleAhead: 0 }, 'आप अगले हैं'],
    [{ status: 'SERVING', peopleAhead: 0 }, 'आपकी बारी है'],
  ])('banner for %j is "%s"', async (over, text) => {
    given(over);
    renderTicket();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('switches to English and back', async () => {
    given();
    const user = userEvent.setup();
    renderTicket();
    await user.click(await screen.findByRole('button', { name: 'Switch to English' }));
    expect(screen.getByRole('heading', { name: 'Your ticket' })).toBeInTheDocument();
    expect(screen.getByText('3 people ahead')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'हिंदी में देखें' }));
    expect(screen.getByText('आपसे पहले 3 लोग')).toBeInTheDocument();
  });

  it('finished tickets speak Hindi too', async () => {
    given({ status: 'CANCELLED' });
    renderTicket();
    expect(await screen.findByText('आपने लाइन छोड़ दी।')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'होम पर जाएँ' })).toBeInTheDocument();
  });
});

describe('Share on WhatsApp', () => {
  it('shares the token and the live queue link, never the secret ticket link', async () => {
    given();
    renderTicket();
    const link = await screen.findByRole('link', { name: /WhatsApp पर भेजें/ });
    const href = link.getAttribute('href')!;
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(href.slice('https://wa.me/?text='.length));
    expect(text).toContain('मेरा टोकन #7');
    expect(text).toContain('Milan Hair Salon');
    expect(text).toContain(`${window.location.origin}/c/s/abcdef123456`);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('/tickets/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('without a salon code, shares just the token', async () => {
    given({ salonCode: undefined });
    renderTicket();
    const href = (await screen.findByRole('link', { name: /WhatsApp/ })).getAttribute('href')!;
    expect(decodeURIComponent(href)).not.toContain('http://localhost');
    expect(decodeURIComponent(href)).toContain('#7');
  });

  it('is not offered once it is the customer\'s turn', async () => {
    given({ status: 'SERVING', peopleAhead: 0 });
    renderTicket();
    await screen.findByText('आपकी बारी है');
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
  });
});

describe('Full-screen turn alert', () => {
  it('appears with vibration when the barber calls the token while the page is open', async () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { vibrate }));
    given();
    const user = userEvent.setup();
    renderTicket();
    await screen.findByText('आपसे पहले 3 लोग');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    given({ status: 'CALLED', peopleAhead: 0 });
    act(() =>
      fireSocket('queue:updated', {
        salonId: 'salon-1',
        currentToken: 7,
        queueStatus: 'ACTIVE',
        averageServiceMinutes: 10,
        entries: [{ id: 't1', tokenNumber: 7, status: 'CALLED' }],
      }),
    );

    const alert = await screen.findByRole('alertdialog', { name: 'आपकी बारी!' });
    expect(within(alert).getByText('टोकन #7')).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalled();
    const ok = within(alert).getByRole('button', { name: 'ठीक है, आ रहा हूँ' });
    expect(ok).toHaveFocus();
    await user.click(ok);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows only once per ticket, even after a reload', async () => {
    given({ status: 'CALLED', peopleAhead: 0 });
    const first = renderTicket();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    first.unmount();

    renderTicket();
    await screen.findByText('आपकी बारी है');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not appear while waiting or once the service is running', async () => {
    given({ status: 'SERVING', peopleAhead: 0 });
    renderTicket('t9');
    await screen.findByText('आपकी बारी है');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('rating a finished visit', () => {
  it('a completed ticket asks for stars', async () => {
    given({ status: 'COMPLETED' });
    renderTicket();
    expect(await screen.findByRole('heading', { name: 'आपकी सेवा कैसी रही?' })).toBeInTheDocument();
  });

  it('a cancelled ticket does not', async () => {
    given({ status: 'CANCELLED' });
    renderTicket();
    await screen.findByText('आपने लाइन छोड़ दी।');
    expect(screen.queryByRole('heading', { name: 'आपकी सेवा कैसी रही?' })).not.toBeInTheDocument();
  });
});
