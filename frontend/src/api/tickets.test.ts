import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTicketStatus } from './tickets';

afterEach(() => vi.unstubAllGlobals());

describe('fetchTicketStatus', () => {
  it('sends the access token in a header, never in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ticket: { status: 'WAITING' } }) });
    vi.stubGlobal('fetch', fetchMock);

    await fetchTicketStatus('t1', 'secret-token-value');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/queue-tickets\/t1$/);
    expect(String(url)).not.toContain('secret-token-value');
    expect(init.headers['X-Ticket-Token']).toBe('secret-token-value');
  });
});