// backend/src/services/geocode.service.ts
import { env } from '../config/env';

export interface GeoPlace {
  district: string | null;
  state: string | null;
}

// Nominatim's policy: at most 1 request per second, identify yourself, cache results.
let chain: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}

const cache = new Map<string, GeoPlace>();

export async function reverseGeocode(lat: number, lng: number): Promise<GeoPlace> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`; // ~100 m cells
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const place = await throttled(async () => {
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '14',
      lat: String(lat),
      lon: String(lng),
    });
    if (env.GEOCODE_ACCEPT_LANGUAGE) params.set('accept-language', env.GEOCODE_ACCEPT_LANGUAGE);

    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'User-Agent': env.OUTBOUND_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`geocode status ${res.status}`);

    const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
    return {
      district: a.state_district ?? a.county ?? null,
      state: a.state ?? null,
    } satisfies GeoPlace;
  });

  if (cache.size > 500) cache.clear();
  cache.set(cacheKey, place);
  return place;
}