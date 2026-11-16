// frontend/src/pages/ShopRecover.test.tsx — get your orders back with the shop's code (Commerce C5b).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopRecover from './ShopRecover';
import { renderPage } from '../test/utils';
import { resetLangForTests, setLang } from '../lib/i18n';
import { resetShopSessionForTests } from '../lib/shopSession';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
let verify: (init: RequestInit) => Response;

beforeEach(() => {
  resetLangForTests();
  setLang('en');
  resetShopSessionForTests();
  fetchMock.mockReset().mockImplementation(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url, 'http://x').pathname}`;
    if (key === 'POST /api/shop/session') return reply(200, { csrfToken: 'csrf-1', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    if (key === 'GET /api/shop/contact') return reply(200, { contactPhone: '+919800000000' });
    if (key === 'POST /api/shop/recovery/verify') return verify(init);
    throw new Error(`unexpected fetch ${key}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const render = () => renderPage(<ShopRecover />, { path: '/c/shop/recover', route: '/c/shop/recover' });

describe('Get your orders back', () => {
  it('explains the call-back steps and offers to call the shop', async () => {
    render();
    expect(screen.getByText(/calls you back on the number you ordered with/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Call the shop: +919800000000' })).toHaveAttribute('href', 'tel:+919800000000');
    expect(screen.getByRole('button', { name: 'Get my orders back' })).toBeDisabled();
  });

  it('sends number + code; success goes to My Orders', async () => {
    const user = userEvent.setup();
    verify = () => reply(200, { recovered: true, csrfToken: 'csrf-2', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    render();
    await user.type(screen.getByLabelText('Mobile number you ordered with'), '9876543210');
    await user.type(screen.getByLabelText('6-digit code'), '482 913');
    await user.click(screen.getByRole('button', { name: 'Get my orders back' }));
    expect(await screen.findByRole('status')).toHaveTextContent('This phone now sees your orders');
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/recovery/verify'))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ phone: '9876543210', code: '482913' });
    expect(((call[1] as RequestInit).headers as Record<string, string>)['X-Shop-CSRF']).toBe('csrf-1');
    await waitFor(() => expect(screen.getByText('OTHER PAGE')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('a wrong code shows the server message', async () => {
    const user = userEvent.setup();
    verify = () => reply(400, { code: 'INVALID_CODE', message: 'That number and code do not match, or the code has expired.' });
    render();
    await user.type(screen.getByLabelText('Mobile number you ordered with'), '9876543210');
    await user.type(screen.getByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Get my orders back' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
  });
});
