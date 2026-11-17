// frontend/src/pages/QueueTracking.shop.test.tsx — the shop first on waiting tickets (Option A, 17 Nov 2026).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import QueueTracking from './QueueTracking';
import { renderPage } from '../test/utils';
import { resetSocket } from '../test/fakeSocket';
import * as tickets from '../api/tickets';
import * as push from '../lib/push';
import * as feed from '../api/feed';
import * as shop from '../api/shop';
import { setLang } from '../lib/i18n';

vi.mock('../lib/socket', () => import('../test/fakeSocket'));
vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn(), leaveTicket: vi.fn() }));
vi.mock('../lib/push', () => ({ fetchPushConfig: vi.fn(), enablePush: vi.fn(), disablePush: vi.fn(), pushSupport: vi.fn() }));
vi.mock('../api/feed', () => ({ fetchSalonFeed: vi.fn(), reverseGeocode: vi.fn() }));
vi.mock('../api/shop', () => ({ fetchCatalog: vi.fn(), fetchCatalogCategories: vi.fn(), fetchShopStatus: vi.fn() }));

const TOKEN = 'a'.repeat(40);
const base = {
  ticketId: 't1', salonId: 'salon-1', tokenNumber: 7, status: 'WAITING', currentToken: 4, peopleAhead: 3,
  estimatedWaitMinutes: 30, queueStatus: 'ACTIVE', services: [], durationMinutes: 10, remainingSeconds: null,
};
const given = (overrides: Record<string, unknown> = {}) =>
  vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({ ...base, ...overrides });
const renderTracking = () => renderPage(<QueueTracking />, { path: '/tickets/:ticketId', route: `/tickets/t1?accessToken=${TOKEN}` });

beforeEach(() => {
  setLang('en');
  resetSocket();
  vi.mocked(tickets.fetchTicketStatus).mockReset();
  vi.mocked(push.fetchPushConfig).mockReset().mockResolvedValue({ enabled: false, publicKey: null });
  vi.mocked(push.pushSupport).mockReset().mockReturnValue('ok');
  vi.mocked(feed.fetchSalonFeed).mockReset().mockResolvedValue([]);
  vi.mocked(shop.fetchShopStatus).mockReset().mockResolvedValue({ enabled: true, showStrip: true });
  vi.mocked(shop.fetchCatalog).mockReset().mockResolvedValue([
    { id: 'p1', name: 'Beard Oil 50 ml', brand: '', categoryId: null, mrpPaise: 25000, sellingPricePaise: 22000, discountPercent: 12, availability: 'IN_STOCK', image: null },
  ]);
});

describe('Ticket page: shop first while waiting', () => {
  it('the shop comes BEFORE the token card, once, with the token bar', async () => {
    given();
    renderTracking();
    const band = await screen.findByRole('region', { name: 'Shop while you wait' }, { timeout: 5000 });
    const card = screen.getByRole('region', { name: 'Your token' });
    expect(band.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Beard Oil 50 ml/ })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'From the shop' })).not.toBeInTheDocument();
    expect(screen.getByText('3 people ahead of you')).toBeInTheDocument();
    expect(card).toHaveAttribute('id', 'token');
  });

  it('shop off: the ticket page is unchanged (no band, no token bar)', async () => {
    vi.mocked(shop.fetchShopStatus).mockResolvedValue({ enabled: false, showStrip: false });
    given();
    renderTracking();
    await screen.findByRole('region', { name: 'Your token' });
    await waitFor(() => expect(shop.fetchShopStatus).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Shop while you wait' })).not.toBeInTheDocument();
    expect(screen.queryByText('3 people ahead of you')).not.toBeInTheDocument();
  });

  it('your turn: no shop at all (go to the counter)', async () => {
    given({ status: 'CALLED', peopleAhead: 0 });
    renderTracking();
    await screen.findByRole('region', { name: 'Your token' });
    expect(shop.fetchShopStatus).not.toHaveBeenCalled();
  });
});
