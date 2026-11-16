// frontend/src/lib/shopStatus.ts — is the shop switched on? Read by the bottom bar, which renders outside
// React Query (and in tests without it), so this is a tiny store of its own: one request, re-checked at most
// every 5 minutes when a screen asks. Any failure counts as "off", so the app looks exactly as before.
import { useEffect, useSyncExternalStore } from 'react';
import { fetchShopStatus } from '../api/shop';

const RECHECK_MS = 5 * 60_000;
let enabled = false;
let checkedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next !== enabled) {
    enabled = next;
    listeners.forEach((l) => l());
  }
}

export function refreshShopEnabled(force = false): Promise<void> {
  if (!force && Date.now() - checkedAt < RECHECK_MS) return Promise.resolve();
  inFlight ??= fetchShopStatus()
    .then((s) => set(!!s.enabled))
    .catch(() => set(false))
    .finally(() => {
      checkedAt = Date.now();
      inFlight = null;
    });
  return inFlight;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useShopEnabled(): boolean {
  const on = useSyncExternalStore(subscribe, () => enabled, () => false);
  useEffect(() => {
    void refreshShopEnabled();
  }, []);
  return on;
}

// Tests only.
export function setShopEnabledForTests(v: boolean) {
  checkedAt = Date.now();
  set(v);
}
