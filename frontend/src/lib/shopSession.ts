// frontend/src/lib/shopSession.ts — the customer's shop session (Commerce C4).
// The device key lives ONLY in an HttpOnly cookie the page can't read. This module keeps the short-lived
// CSRF token in memory (never in localStorage, sessionStorage or the address bar) and adds it to every
// shop change. A "blocked" 403 (expired token, cookie cleared) gets a fresh session and one retry.
import { apiUrl } from '../api/client';

let csrf: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

export class ShopHttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.message === 'string' ? body.message : 'Something went wrong. Please try again.');
    this.status = status;
    this.body = body;
  }
}

async function raw(path: string, init: RequestInit & { headers?: Record<string, string> }) {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, body };
}

// Creates the device cookie if missing; returns the CSRF token.
export function ensureShopSession(force = false): Promise<string> {
  if (!force && csrf && csrf.expiresAt - Date.now() > 60_000) return Promise.resolve(csrf.token);
  inFlight ??= raw('/api/shop/session', { method: 'POST', body: '{}' })
    .then((r) => {
      if (!r.ok) throw new ShopHttpError(r.status, r.body);
      const token = String(r.body.csrfToken);
      csrf = { token, expiresAt: Date.parse(String(r.body.expiresAt)) || Date.now() + 3600_000 };
      return token;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

const isBlocked = (r: { status: number; body: Record<string, unknown> }) =>
  r.status === 403 && String(r.body.message ?? '').startsWith('This request was blocked');

// A shop change. Resolves with { status, body } for every answer the server gave (the caller decides what a
// 409 means); rejects only when the server could not be reached (the outcome is then unknown).
export async function shopWrite(path: string, body: unknown, headers: Record<string, string> = {}) {
  const send = async (force: boolean) =>
    raw(path, { method: 'POST', body: JSON.stringify(body), headers: { ...headers, 'X-Shop-CSRF': await ensureShopSession(force) } });
  const first = await send(false);
  return isBlocked(first) ? send(true) : first;
}

// After device linking the server issues a new device key, and a CSRF token bound to it.
export function adoptShopCsrf(token: string, expiresAt: string) {
  csrf = { token, expiresAt: Date.parse(expiresAt) || Date.now() + 3600_000 };
}

// Tests only.
export function resetShopSessionForTests() {
  csrf = null;
  inFlight = null;
}
