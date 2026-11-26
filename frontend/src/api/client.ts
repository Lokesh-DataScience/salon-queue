// frontend/src/api/client.ts
// The live site is served by the same server as the API, so production always uses its own address.
const API_URL = import.meta.env.DEV ? (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') : '';
export const apiUrl = (path: string) => `${API_URL}${path}`;

export const SESSION_EXPIRED_EVENT = 'barber:session-expired';

export class ApiError extends Error {
  status: number;
  fieldErrors?: Record<string, string[] | undefined>;
  code?: string; // e.g. CUSTOMER_DETAILS_REQUIRED
  constructor(message: string, status: number, fieldErrors?: Record<string, string[] | undefined>, code?: string) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

type RefreshOutcome = 'ok' | 'denied' | 'error';
const RACE_WAIT_MS = import.meta.env.MODE === 'test' ? 0 : 1500;
let refreshInFlight: Promise<RefreshOutcome> | null = null;

// Single-flight: ten requests failing at once trigger one refresh, not ten.
function refreshSession(): Promise<RefreshOutcome> {
  refreshInFlight ??= fetch(`${API_URL}/api/auth/barber/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((res): RefreshOutcome => (res.ok ? 'ok' : res.status === 401 ? 'denied' : 'error'))
    .catch((): RefreshOutcome => 'error')
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...rest } = init ?? {};
  const send = () =>
    fetch(`${API_URL}${path}`, {
      credentials: 'include',
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(extraHeaders as Record<string, string> | undefined) },
    });

  let res = await send();

  // Barber-session routes (barber + in-app admin): if the access token expired, refresh silently
  // and retry once. (A 401 means the handler never ran, so retrying a POST cannot double-apply it.)
  if (res.status === 401 && (path.startsWith('/api/barber/') || path.startsWith('/api/admin/'))) {
    const outcome = await refreshSession();
    if (outcome === 'ok') {
      res = await send();
    } else if (outcome === 'denied') {
      // 'denied' usually means another tab, or the installed app sharing this browser's cookies,
      // rotated the token a moment earlier. Its new cookies may still be on their way, so give
      // them a moment, then retry; if still refused, refresh once more with whatever cookie is now in the jar.
      await new Promise((r) => setTimeout(r, RACE_WAIT_MS));
      res = await send();
      if (res.status === 401 && (await refreshSession()) === 'ok') res = await send();
    }
    // Only a 401 after all of that means the session really ended.
    if (outcome !== 'error' && res.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Something went wrong.' }));
    throw new ApiError(body.message ?? `Request failed with status ${res.status}`, res.status, body.errors, body.code);
  }

  return res.json() as Promise<T>;
}
