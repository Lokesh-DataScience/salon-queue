// frontend/src/api/shopAdmin.test.ts — CSRF token handling + money helpers (Commerce C1).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { changeShopStock, resetShopCsrf, rupees, toPaise, paiseToInput, fetchShopProducts } from './shopAdmin';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const calls = () => fetchMock.mock.calls.map((c) => ({ url: String(c[0]), init: c[1] as RequestInit }));
const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

beforeEach(() => {
  fetchMock.mockReset();
  resetShopCsrf();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const session = (token = 't1') => reply(200, { csrfToken: token, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
const product = { product: { id: 'p1', stockOnHand: 9 } };

describe('shop admin writes', () => {
  it('fetches a CSRF token once, keeps it in memory and sends it on every write', async () => {
    fetchMock.mockResolvedValueOnce(session('tok-A')).mockResolvedValueOnce(reply(200, product)).mockResolvedValueOnce(reply(200, product));
    await changeShopStock('p1', { type: 'STOCK_COUNT', qty: 9, expectedOnHand: 10, reason: '' });
    await changeShopStock('p1', { type: 'STOCK_COUNT', qty: 9, expectedOnHand: 9, reason: '' });
    const c = calls();
    expect(c.map((x) => x.url)).toEqual([
      expect.stringContaining('/api/admin/shop/session'),
      expect.stringContaining('/api/admin/shop/products/p1/stock'),
      expect.stringContaining('/api/admin/shop/products/p1/stock'),
    ]);
    expect(header(c[1].init, 'X-Admin-CSRF')).toBe('tok-A');
    expect(header(c[2].init, 'X-Admin-CSRF')).toBe('tok-A');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('gets a fresh token and retries once when the token was refused', async () => {
    fetchMock
      .mockResolvedValueOnce(session('old'))
      .mockResolvedValueOnce(reply(403, { message: 'This request was blocked for your security. Refresh the page and try again.' }))
      .mockResolvedValueOnce(session('new'))
      .mockResolvedValueOnce(reply(200, product));
    await expect(changeShopStock('p1', { type: 'STOCK_COUNT', qty: 1, expectedOnHand: 1, reason: '' })).resolves.toEqual(product.product);
    expect(header(calls()[3].init, 'X-Admin-CSRF')).toBe('new');
  });

  it('does not retry a founder-only refusal (Cofounder)', async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { message: 'Only the founder can do this.' }));
    await expect(changeShopStock('p1', { type: 'STOCK_COUNT', qty: 1, expectedOnHand: 1, reason: '' })).rejects.toThrow(
      'Only the founder can do this.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads need no token', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { products: [] }));
    await fetchShopProducts({ search: 'oil' });
    expect(calls()[0].url).toContain('/api/admin/shop/products?search=oil');
  });
});

describe('money helpers', () => {
  it('converts rupees text to paise and back', () => {
    expect(toPaise('249')).toBe(24900);
    expect(toPaise('249.5')).toBe(24950);
    expect(toPaise('249.50')).toBe(24950);
    for (const bad of ['', '-1', '1.234', 'abc', '1e3']) expect(toPaise(bad)).toBeNull();
    expect(paiseToInput(24950)).toBe('249.50');
    expect(paiseToInput(25000)).toBe('250');
    expect(rupees(25000)).toBe('₹250');
    expect(rupees(24950)).toBe('₹249.50');
  });
});
