const PREFIX = 'joinKey:';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// The same key for the same scan, even across Try again, reloads and tabs.
export function getJoinKey(salonId: string): string {
  try {
    const raw = localStorage.getItem(PREFIX + salonId);
    if (raw) {
      const { k, t } = JSON.parse(raw) as { k?: unknown; t?: unknown };
      if (typeof k === 'string' && typeof t === 'number' && Date.now() - t < MAX_AGE_MS) return k;
    }
  } catch { /* storage unavailable: fall through to a fresh key */ }
  const k = randomKey();
  try { localStorage.setItem(PREFIX + salonId, JSON.stringify({ k, t: Date.now() })); } catch { /* ignore */ }
  return k;
}

export function clearJoinKey(salonId: string) {
  try { localStorage.removeItem(PREFIX + salonId); } catch { /* ignore */ }
}