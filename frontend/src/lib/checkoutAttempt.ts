// frontend/src/lib/checkoutAttempt.ts — idempotency for "Place order" (§8.3).
// sessionStorage holds ONLY: the idempotency key (a random UUID), a random per-attempt nonce, and a SHA-256
// fingerprint of the product ids + quantities + that nonce. No name, phone, address, cookie or CSRF token.
// A retry after a lost answer reuses the key while the cart is the same, so the server returns the original
// order instead of making a second one. The attempt is cleared once the outcome is certain.
const KEY = 'svq.checkout.attempt.v1';

interface Attempt {
  key: string;
  nonce: string;
  fingerprint: string;
}

const uuid = () => crypto.randomUUID();

async function fingerprintOf(items: { productId: string; qty: number }[], nonce: string) {
  const canonical = JSON.stringify({ items: [...items].sort((a, b) => a.productId.localeCompare(b.productId)).map((i) => [i.productId, i.qty]), nonce });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function read(): Attempt | null {
  try {
    const a = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    return a && typeof a.key === 'string' && typeof a.nonce === 'string' && typeof a.fingerprint === 'string' ? a : null;
  } catch {
    return null;
  }
}

// The key to send now: the stored one if this is the same cart, otherwise a new attempt.
export async function attemptKeyFor(items: { productId: string; qty: number }[]): Promise<string> {
  const prev = read();
  if (prev && (await fingerprintOf(items, prev.nonce)) === prev.fingerprint) return prev.key;
  const nonce = uuid();
  const next: Attempt = { key: uuid(), nonce, fingerprint: await fingerprintOf(items, nonce) };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the key still protects this one tap */
  }
  return next.key;
}

export function clearAttempt() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
