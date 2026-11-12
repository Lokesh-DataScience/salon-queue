// frontend/src/api/flags.ts
// Feature flags the barber app reads. Switched in Admin → Tech → Tools & flags.
import { apiFetch } from './client';

export type AppFlags = Record<string, { enabled: boolean; value: string }>;

export function fetchBarberFlags() {
  return apiFetch<{ flags: AppFlags }>('/api/barber/flags').then((r) => r.flags);
}

// A flag that is missing (not loaded yet, or never created) uses the fallback.
export function flagOn(flags: AppFlags | undefined, key: string, fallback: boolean) {
  return flags?.[key]?.enabled ?? fallback;
}
