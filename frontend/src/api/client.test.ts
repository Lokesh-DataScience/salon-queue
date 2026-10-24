import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiError, SESSION_EXPIRED_EVENT } from './client';

const fetchMock = vi.fn();
const onExpired = vi.fn();

function reply(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  fetchMock.mockReset();
  onExpired.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
});
afterEach(() => {
  window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { hello: 'world' }));
    await expect(apiFetch('/api/salons/nearby')).resolves.toEqual({ hello: 'world' });
  });

  it('throws an ApiError carrying status and field errors', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(400, { message: 'Invalid request.', errors: { phone: ['Enter a valid mobile number'] } }),
    );
        const err = (await apiFetch('/api/queues/x/join').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: 'Invalid request.' });
    expect(err.fieldErrors?.phone?.[0]).toBe('Enter a valid mobile number');
  });

  it('falls back to a friendly message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ message: 'Something went wrong.', status: 502 });
  });

  it('on a barber 401: refreshes silently, then retries once', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { message: 'Not authenticated.' }))
      .mockResolvedValueOnce(reply(200, { ok: true }))
      .mockResolvedValueOnce(reply(200, { waiting: [] }));

    await expect(apiFetch('/api/barber/queue')).resolves.toEqual({ waiting: [] });
    expect(urls()).toHaveLength(3);
    expect(urls()[1]).toMatch(/\/api\/auth\/barber\/refresh$/);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('many simultaneous 401s trigger exactly one refresh', async () => {
    let refreshed = false;
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/auth/barber/refresh')) {
        refreshCalls++;
        await Promise.resolve();
        refreshed = true;
        return reply(200, { ok: true });
      }
      return refreshed ? reply(200, { ok: true }) : reply(401, { message: 'Not authenticated.' });
    });

    await Promise.all([apiFetch('/api/barber/a'), apiFetch('/api/barber/b'), apiFetch('/api/barber/c')]);
    expect(refreshCalls).toBe(1);
  });

  it('still 401 after refreshing: announces session expiry and throws', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { message: 'Not authenticated.' }))
      .mockResolvedValueOnce(reply(200, { ok: true }))
      .mockResolvedValueOnce(reply(401, { message: 'Not authenticated.' }));

    await expect(apiFetch('/api/barber/queue')).rejects.toMatchObject({ status: 401 });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('refresh denied but retry works (another tab rotated first): succeeds quietly', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { message: 'Not authenticated.' }))
      .mockResolvedValueOnce(reply(401, { message: 'Session expired. Please log in again.' }))
      .mockResolvedValueOnce(reply(200, { waiting: [] }));

    await expect(apiFetch('/api/barber/queue')).resolves.toEqual({ waiting: [] });
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('refresh server error: no retry, no forced logout', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { message: 'Not authenticated.' }))
      .mockResolvedValueOnce(reply(500, { message: 'Something went wrong.' }));

    await expect(apiFetch('/api/barber/queue')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('a wrong-password 401 on login never triggers a refresh', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { message: 'Invalid email or password.' }));
    await expect(apiFetch('/api/auth/barber/login', { method: 'POST' })).rejects.toMatchObject({
      message: 'Invalid email or password.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onExpired).not.toHaveBeenCalled();
  });
  it('merges extra headers without losing Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await apiFetch('/api/queue-tickets/t1', { headers: { 'X-Ticket-Token': 'abc' } });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'X-Ticket-Token': 'abc',
    });
  });
});