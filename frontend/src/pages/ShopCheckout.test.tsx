// frontend/src/pages/ShopCheckout.test.tsx — Commerce C4a: checkout, idempotency, My Orders, order page, cancel.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopCheckout from './ShopCheckout';
import ShopOrders from './ShopOrders';
import ShopOrder from './ShopOrder';
import { renderPage } from '../test/utils';
import { resetLangForTests, setLang } from '../lib/i18n';
import { addToCart, clearCart, resetCartForTests } from '../lib/cart';
import { resetShopSessionForTests } from '../lib/shopSession';
import { showsBottomNav } from '../components/CustomerChrome';
import * as shop from '../api/shop';
import type { Quote } from '../api/shop';
import type { OrderDetail } from '../api/shopOrders';

vi.mock('../api/shop', () => ({ quoteCart: vi.fn() }));

const A = '11111111-1111-4111-8111-111111111111';
const fetchMock = vi.fn();
const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const quote = (o: Partial<Quote> = {}): Quote => ({
  lines: [{ productId: A, qty: 2, problem: null, maxQty: null, unitPricePaise: 22000, mrpPaise: 25000, lineTotalPaise: 44000, name: 'Beard Oil', brand: '', image: null }],
  subtotalPaise: 44000, deliveryFeePaise: 0, totalPaise: 44000, orderProblems: [], codMaxOrderPaise: 200000, ok: true, sameDayRequestable: false, ...o,
});
const session = () => reply(200, { csrfToken: 'csrf-1', expiresAt: new Date(Date.now() + 3600_000).toISOString() });

// Route fetches by URL so each test only describes what matters.
function serve(handlers: Record<string, (init: RequestInit) => Response | Promise<Response>>) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, 'http://x').pathname;
    const key = `${init.method ?? 'GET'} ${path}`;
    const h = handlers[key];
    if (!h) throw new Error(`unexpected fetch ${key}`);
    return h(init);
  });
}
const calls = (key: string) =>
  fetchMock.mock.calls.filter(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${new URL(u as string, 'http://x').pathname}` === key);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetLangForTests();
  setLang('en');
  clearCart();
  resetCartForTests();
  resetShopSessionForTests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(shop.quoteCart).mockReset().mockResolvedValue(quote());
  addToCart(A, 2, 22000);
});
afterEach(() => vi.unstubAllGlobals());

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Your name'), 'Ravi');
  await user.type(screen.getByLabelText('Mobile number'), '9876543210');
  await user.type(screen.getByLabelText('House number / street'), '12 Main Road');
  await user.click(screen.getByRole('checkbox', { name: /Save my name, phone and address/ }));
  await user.click(screen.getByRole('button', { name: /Place order · ₹440/ }));
}

const renderCheckout = () => renderPage(<ShopCheckout />, { path: '/c/shop/checkout', route: '/c/shop/checkout' });

describe('Checkout', () => {
  it('places the order with the server total, CSRF token and an order key; nothing personal is stored on the phone', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/shop/session': () => session(),
      'GET /api/shop/prefill': () => reply(200, { prefill: null, verified: false }),
      'POST /api/shop/orders': () => reply(201, { order: { id: 'o1', orderNumber: 'SQ-1001' } }),
    });
    renderCheckout();
    await fillAndSubmit(user);
    await waitFor(() => expect(screen.getByText('OTHER PAGE')).toBeInTheDocument()); // navigated to the order page

    const [, init] = calls('POST /api/shop/orders')[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Shop-CSRF']).toBe('csrf-1');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      items: [{ productId: A, qty: 2 }],
      expectedTotalPaise: 44000,
      consent: true,
      customer: { name: 'Ravi', phone: '9876543210', addressLine1: '12 Main Road' },
    });
    expect(localStorage.getItem('svq.cart.v1')).toBe('[]'); // cart emptied
    expect(sessionStorage.length).toBe(0); // attempt cleared once certain
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/Ravi|9876543210|Main Road|csrf/);
  });

  it('asks for consent first', async () => {
    const user = userEvent.setup();
    serve({ 'POST /api/shop/session': () => session(), 'GET /api/shop/prefill': () => reply(200, { prefill: null, verified: false }) });
    renderCheckout();
    await user.type(await screen.findByLabelText('Your name'), 'Ravi');
    await user.click(screen.getByRole('button', { name: /Place order/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please tick the box above');
    expect(calls('POST /api/shop/orders')).toHaveLength(0);
  });

  it('a lost answer keeps the same key, so tapping again returns the original order (never a second one)', async () => {
    const user = userEvent.setup();
    let n = 0;
    serve({
      'POST /api/shop/session': () => session(),
      'GET /api/shop/prefill': () => reply(200, { prefill: null, verified: false }),
      'POST /api/shop/orders': () => {
        n += 1;
        if (n === 1) throw new TypeError('Failed to fetch');
        return reply(200, { order: { id: 'o1', orderNumber: 'SQ-1001' }, existing: true });
      },
    });
    renderCheckout();
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent("won't be ordered twice");
    const stored = JSON.parse(sessionStorage.getItem('svq.checkout.attempt.v1')!);
    expect(Object.keys(stored).sort()).toEqual(['fingerprint', 'key', 'nonce']); // nothing personal
    await user.click(screen.getByRole('button', { name: /Place order/ }));
    await waitFor(() => expect(screen.getByText('OTHER PAGE')).toBeInTheDocument());
    const keys = calls('POST /api/shop/orders').map(([, i]) => ((i as RequestInit).headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('a changed price shows the new total and needs another tap', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/shop/session': () => session(),
      'GET /api/shop/prefill': () => reply(200, { prefill: null, verified: false }),
      'POST /api/shop/orders': () =>
        reply(409, {
          code: 'PRICE_CHANGED',
          message: 'Prices changed.',
          quote: quote({ totalPaise: 48000, subtotalPaise: 48000, lines: [{ ...quote().lines[0], unitPricePaise: 24000, lineTotalPaise: 48000 }] }),
        }),
    });
    renderCheckout();
    await fillAndSubmit(user);
    expect(await screen.findByText(/Some prices changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Place order · ₹480/ })).toBeInTheDocument();
    expect(screen.queryByText('OTHER PAGE')).not.toBeInTheDocument();
  });

  it('prefills from the last order on this phone', async () => {
    serve({
      'POST /api/shop/session': () => session(),
      'GET /api/shop/prefill': () =>
        reply(200, { verified: false, prefill: { source: 'last_order', name: 'Ravi', phone: '+919876543210', addressLine1: '12 Main Road', addressLine2: '', landmark: 'temple', pincode: '' } }),
    });
    renderCheckout();
    expect(await screen.findByDisplayValue('Ravi')).toBeInTheDocument();
    expect(screen.getByDisplayValue('9876543210')).toBeInTheDocument();
    expect(screen.getByText(/Filled in from your last order/)).toBeInTheDocument();
  });

  it('too many open orders: explains and links to My Orders', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/shop/session': () => session(),
      'GET /api/shop/prefill': () => reply(200, { prefill: null, verified: false }),
      'POST /api/shop/orders': () => reply(409, { code: 'TOO_MANY_OPEN_ORDERS', max: 2, message: 'You already have 2 orders on the way.' }),
    });
    renderCheckout();
    await fillAndSubmit(user);
    expect(await screen.findByText('You already have 2 orders on the way.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Orders' })).toHaveAttribute('href', '/c/shop/orders');
  });

  it('no bottom bar while filling in the checkout', () => {
    expect(showsBottomNav('/c/shop/checkout', true)).toBe(false);
    expect(showsBottomNav('/c/shop/orders', false)).toBe(true);
  });
});

const detail = (o: Partial<OrderDetail> = {}): OrderDetail => ({
  id: 'o1', orderNumber: 'SQ-1001', status: 'PLACED', paymentMethod: 'COD', paymentStatus: 'COD_PENDING',
  createdAt: '2026-11-16T10:00:00Z', deliveredAt: null, sameDayState: 'NOT_REQUESTED', expectedDeliveryDate: null,
  expectedDeliveryNote: '', cancelReason: '', cancelledBy: null, canCancel: true,
  delivery: { name: 'Ravi', phone: '+919876543210', addressLine1: '12 Main Road', addressLine2: '', landmark: 'temple', pincode: '495001' },
  items: [{ productId: A, name: 'Beard Oil', qty: 2, unitPricePaise: 22000, mrpPaise: 25000, lineTotalPaise: 44000 }],
  subtotalPaise: 44000, deliveryFeePaise: 0, totalPaise: 44000,
  timeline: [{ type: 'placed', to: 'PLACED', note: '', at: '2026-11-16T10:00:00Z' }], contactPhone: '9000000000', ...o,
});

describe('My Orders and the order page', () => {
  it('lists this phone\'s orders', async () => {
    serve({
      'GET /api/shop/orders': () =>
        reply(200, { orders: [{ id: 'o1', orderNumber: 'SQ-1001', status: 'PLACED', totalPaise: 44000, sameDayState: 'NOT_REQUESTED', createdAt: '2026-11-16T10:00:00Z', itemCount: 2 }] }),
    });
    renderPage(<ShopOrders />, { path: '/c/shop/orders', route: '/c/shop/orders' });
    expect(await screen.findByText('SQ-1001')).toBeInTheDocument();
    expect(screen.getByText("Order received — we'll confirm soon")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /SQ-1001/ })).toHaveAttribute('href', '/c/shop/orders/o1');
  });

  it('shows the order and cancels it after confirming', async () => {
    const user = userEvent.setup();
    serve({
      'GET /api/shop/orders/o1': () => reply(200, { order: detail() }),
      'POST /api/shop/session': () => session(),
      'POST /api/shop/orders/o1/cancel': () =>
        reply(200, { order: detail({ status: 'CANCELLED', paymentStatus: 'VOID', canCancel: false, cancelledBy: 'CUSTOMER' }) }),
    });
    renderPage(<ShopOrder />, { path: '/c/shop/orders/:orderId', route: '/c/shop/orders/o1' });
    expect(await screen.findByText('To pay in cash on delivery')).toBeInTheDocument();
    expect(screen.getByText('Ravi · 9876543210')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.type(screen.getByLabelText('Reason (optional)'), 'mistake');
    await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    expect(await screen.findByText('Cancelled by you')).toBeInTheDocument();
    expect(screen.getByText('Nothing to pay')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    const [, init] = calls('POST /api/shop/orders/o1/cancel')[0];
    expect(((init as RequestInit).headers as Record<string, string>)['X-Shop-CSRF']).toBe('csrf-1');
  });

  it('out for delivery: no cancel button', async () => {
    serve({ 'GET /api/shop/orders/o1': () => reply(200, { order: detail({ status: 'OUT_FOR_DELIVERY', canCancel: false }) }) });
    renderPage(<ShopOrder />, { path: '/c/shop/orders/:orderId', route: '/c/shop/orders/o1' });
    expect(await screen.findByText('Out for delivery')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });

  it('another phone\'s order looks missing', async () => {
    serve({ 'GET /api/shop/orders/o9': () => reply(404, { message: 'Order not found.' }) });
    renderPage(<ShopOrder />, { path: '/c/shop/orders/:orderId', route: '/c/shop/orders/o9' });
    expect(await screen.findByText("We couldn't find this order on this phone.")).toBeInTheDocument();
  });
});

import ShopLink from './ShopLink';

describe('C4b: saved details and device linking', () => {
  it('a verified phone starts from its saved details and can keep a change as the new default', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/shop/session': () => session(),
      'GET /api/shop/prefill': () =>
        reply(200, { verified: true, prefill: { source: 'saved', name: 'Ravi', phone: '+919876543210', addressLine1: '12 Main Road', addressLine2: '', landmark: '', pincode: '' } }),
      'POST /api/shop/orders': () => reply(201, { order: { id: 'o1', orderNumber: 'SQ-1001' } }),
      'POST /api/shop/details': () => reply(200, { changed: ['address_line1'] }),
    });
    renderCheckout();
    expect(await screen.findByText('Filled in from your saved details.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Also save these details/ })).not.toBeInTheDocument();
    const line1 = screen.getByLabelText('House number / street');
    await user.clear(line1);
    await user.type(line1, '5 New Road');
    expect(screen.getByRole('checkbox', { name: /Also save these details/ })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /Save my name, phone and address/ }));
    await user.click(screen.getByRole('button', { name: /Place order/ }));
    await waitFor(() => expect(screen.getByText('OTHER PAGE')).toBeInTheDocument());
    const [, init] = calls('POST /api/shop/details')[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ name: 'Ravi', addressLine1: '5 New Road', addressLine2: '', landmark: '', pincode: '' });
  });

  it('an unverified phone never sends saved-detail changes', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/shop/session': () => session(),
      'GET /api/shop/prefill': () =>
        reply(200, { verified: false, prefill: { source: 'last_order', name: 'Ravi', phone: '+919876543210', addressLine1: '12 Main Road', addressLine2: '', landmark: '', pincode: '' } }),
      'POST /api/shop/orders': () => reply(201, { order: { id: 'o1', orderNumber: 'SQ-1001' } }),
    });
    renderCheckout();
    const line1 = await screen.findByLabelText('House number / street');
    await user.clear(line1);
    await user.type(line1, '5 New Road');
    expect(screen.queryByRole('checkbox', { name: /Also save these details/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Save my name, phone and address/ }));
    await user.click(screen.getByRole('button', { name: /Place order/ }));
    await waitFor(() => expect(screen.getByText('OTHER PAGE')).toBeInTheDocument());
    expect(calls('POST /api/shop/details')).toHaveLength(0);
  });

  it('shows a code on this phone, and links with a code from another phone', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/shop/session': () => session(),
      'POST /api/shop/device-link/code': () => reply(200, { code: 'ABCD-EF23', expiresAt: new Date(Date.now() + 600_000).toISOString() }),
      'POST /api/shop/device-link/redeem': () => reply(200, { linked: true, csrfToken: 'csrf-new', expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    });
    renderPage(<ShopLink />, { path: '/c/shop/link', route: '/c/shop/link' });
    await user.click(screen.getByRole('button', { name: 'Make a code' }));
    expect(await screen.findByText('ABCD-EF23')).toBeInTheDocument();
    expect(screen.getByText(/Expires in 10 min · works once/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('8-character code'), 'wxyz-2345');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByText('Done! This phone now sees the same orders.')).toBeInTheDocument();
    const [, init] = calls('POST /api/shop/device-link/redeem')[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ code: 'wxyz-2345' });
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/ABCD|csrf/);
  });

  it('a wrong or expired code shows the server message', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/shop/session': () => session(),
      'POST /api/shop/device-link/redeem': () => reply(400, { code: 'INVALID_CODE', message: 'That code is wrong or has expired.' }),
    });
    renderPage(<ShopLink />, { path: '/c/shop/link', route: '/c/shop/link' });
    await user.type(screen.getByLabelText('8-character code'), 'AAAA-BBBB');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has expired.');
  });
});
