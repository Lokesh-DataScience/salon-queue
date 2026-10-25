// frontend/src/api/client.ts
// The live site is served by the same server as the API, so production always uses its own address.
const API_URL = import.meta.env.DEV ? (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') : '';

export const SESSION_EXPIRED_EVENT = 'barber:session-expired';

export class ApiError extends Error {
  status: number;
  fieldErrors?: Record<string, string[] | undefined>;
  constructor(message: string, status: number, fieldErrors?: Record<string, string[] | undefined>) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

type RefreshOutcome = 'ok' | 'denied' | 'error';
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

  // Barber-only routes: if the access token expired, refresh silently and retry once.
  // (A 401 means the handler never ran, so retrying a POST cannot double-apply it.)
  if (res.status === 401 && path.startsWith('/api/barber/')) {
    const outcome = await refreshSession();
    // 'denied' can simply mean another tab rotated the token first. Its new cookies are
    // already in the shared cookie jar, so retry once for 'ok' and 'denied' alike.
    if (outcome !== 'error') {
      res = await send();
      if (res.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Something went wrong.' }));
    throw new ApiError(body.message ?? `Request failed with status ${res.status}`, res.status, body.errors);
  }

  return res.json() as Promise<T>;
}