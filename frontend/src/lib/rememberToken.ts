// frontend/src/lib/rememberToken.ts
// One random "remember me" token per salon, so a returning customer skips the details form there.
// This is the ONLY thing stored about the customer. Never a name or phone number (spec §20).
const KEY = 'svq.remember.v1';
const MAX_SALONS = 20;
const TOKEN = /^[a-f0-9]{64}$/;

type Store = Record<string, { token: string; savedAt: number }>;

// Every storage call is wrapped: private mode, blocked storage or a corrupt value
// must degrade to "not remembered", never crash the page.
function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Store = {};
    for (const [salonId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const e = value as { token?: unknown; savedAt?: unknown } | null;
      if (e && typeof e.token === 'string' && TOKEN.test(e.token) && typeof e.savedAt === 'number') {
        out[salonId] = { token: e.token, savedAt: e.savedAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function write(store: Store) {
  try {
    const newest = Object.entries(store).sort((a, b) => a[1].savedAt - b[1].savedAt).slice(-MAX_SALONS);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    /* storage unavailable: the customer just fills the form again next time */
  }
}

export function getRememberToken(salonId: string): string | null {
  return read()[salonId]?.token ?? null;
}

export function saveRememberToken(salonId: string, token: string) {
  if (!TOKEN.test(token)) return;
  const store = read();
  store[salonId] = { token, savedAt: Date.now() };
  write(store);
}

export function clearRememberToken(salonId: string) {
  const store = read();
  if (!(salonId in store)) return;
  delete store[salonId];
  write(store);
}