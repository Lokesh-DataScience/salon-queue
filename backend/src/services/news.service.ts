import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { isStale } from '../utils/refreshWindow';
import { slug } from './place.service';
import { googleNewsRss } from './news-sources/googleNewsRss';
import type { FeedSource } from './news-sources/types';

type Scope = 'district' | 'state';
interface PlaceRow {
  place_key: string;
  district: string | null;
  state: string | null;
}
export interface FeedDef {
  key: string;
  scope: Scope;
  query: string;
}

let source: FeedSource = googleNewsRss;
export function setNewsSource(s: FeedSource) {
  source = s;
}

// Every salon in a district shares the same two feeds, so 50 salons cost 2 fetches a day.
export function feedDefsFor(p: PlaceRow): FeedDef[] {
  const defs: FeedDef[] = [];
  if (p.district) {
    defs.push({
      scope: 'district',
      key: `district:${slug(p.state) || '-'}/${slug(p.district)}`,
      query: [p.district, p.state].filter(Boolean).join(' '), // e.g. "Korba Chhattisgarh"
    });
  }
  if (p.state) defs.push({ scope: 'state', key: `state:${slug(p.state)}`, query: p.state });
  return defs;
}

// ── Refresh: single-flight per feed, with a cooldown after a failure ──────
const inFlight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
const FAIL_COOLDOWN_MS = 30 * 60 * 1000;
const canRetry = (key: string) => Date.now() - (failedAt.get(key) ?? 0) > FAIL_COOLDOWN_MS;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function doRefresh(def: FeedDef) {
  try {
    const items = await source.fetch(def.query);
    if (items.length > 0) {
      const { error } = await supabase.rpc('replace_news_items', {
        p_feed_key: def.key,
        p_query: def.query,
        p_items: items,
      });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('news_feeds')
        .upsert(
          { feed_key: def.key, query: def.query, last_attempt_at: new Date().toISOString() },
          { onConflict: 'feed_key' },
        );
      if (error) throw error;
    }
    failedAt.delete(def.key);
  } catch (err) {
    failedAt.set(def.key, Date.now());
    const reason = (err as { message?: string })?.message ?? 'unknown';
    console.error(`[news] refresh failed (${def.scope} feed): ${String(reason).slice(0, 160)}`);
  }
}

export function refreshFeed(def: FeedDef): Promise<void> {
  const running = inFlight.get(def.key);
  if (running) return running;
  const p = doRefresh(def).finally(() => inFlight.delete(def.key));
  inFlight.set(def.key, p);
  return p;
}

// ── Read: what a customer's tracking page gets ───────────────────────────
export interface FeedItem {
  kind: 'news'; // later: 'featured' | 'sponsored'
  scope: Scope;
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
}

export async function getFeedForSalon(salonId: string): Promise<FeedItem[]> {
  const { data: salon, error } = await supabase
    .from('salons')
    .select('places(place_key, district, state)')
    .eq('id', salonId)
    .maybeSingle();
  if (error) throw error;
  if (!salon) throw new AppError('Salon not found.', 404);

  const rel = (salon as { places: PlaceRow | PlaceRow[] | null }).places;
  const place = Array.isArray(rel) ? rel[0] : rel;
  if (!place) return [];

  const defs = feedDefsFor(place);
  if (defs.length === 0) return [];
  const keys = defs.map((d) => d.key);

  const { data: feeds, error: feedsError } = await supabase
    .from('news_feeds')
    .select('feed_key, last_attempt_at')
    .in('feed_key', keys);
  if (feedsError) throw feedsError;

  const attempts = new Map((feeds ?? []).map((f) => [f.feed_key as string, f.last_attempt_at as string | null]));
  const now = new Date();
  const stale = defs.filter((d) => {
    const last = attempts.get(d.key);
    return isStale(last ? new Date(last) : null, now, env.NEWS_REFRESH_HOUR_IST) && canRetry(d.key);
  });

  if (stale.length) {
    const work = Promise.all(stale.map(refreshFeed));
    const neverFetched = stale.some((d) => !attempts.has(d.key));
    if (neverFetched) {
      await Promise.race([work, new Promise<void>((r) => setTimeout(r, 10_000).unref())]);
    } else {
      void work; // show yesterday's headlines now, refresh in the background
    }
  }

  const { data: rows, error: rowsError } = await supabase
    .from('news_items')
    .select('feed_key, position, title, url, source, published_at')
    .in('feed_key', keys)
    .order('position', { ascending: true });
  if (rowsError) throw rowsError;

  const out: FeedItem[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    for (const r of (rows ?? []).filter((x) => x.feed_key === def.key)) {
      if (out.length >= env.NEWS_ITEMS_PER_PLACE) return out;
      if (seen.has(r.url) || seen.has(r.title)) continue;
      seen.add(r.url);
      seen.add(r.title);
      out.push({
        kind: 'news',
        scope: def.scope,
        title: r.title,
        url: r.url,
        source: r.source,
        publishedAt: r.published_at,
      });
    }
  }
  return out;
}

// ── Daily job entry point ────────────────────────────────────────────────
export async function refreshAllStaleFeeds(): Promise<{ checked: number; refreshed: number }> {
  const { data, error } = await supabase
    .from('salons')
    .select('places!inner(place_key, district, state)')
    .not('place_id', 'is', null);
  if (error) throw error;

  const defs = new Map<string, FeedDef>();
  for (const row of data ?? []) {
    const rel = (row as unknown as { places: PlaceRow | PlaceRow[] }).places;
    const place = Array.isArray(rel) ? rel[0] : rel;
    if (place) for (const d of feedDefsFor(place)) defs.set(d.key, d);
  }
  if (defs.size === 0) return { checked: 0, refreshed: 0 };

  const { data: feeds, error: feedsError } = await supabase
    .from('news_feeds')
    .select('feed_key, last_attempt_at')
    .in('feed_key', [...defs.keys()]);
  if (feedsError) throw feedsError;
  const attempts = new Map((feeds ?? []).map((f) => [f.feed_key as string, f.last_attempt_at as string | null]));

  const now = new Date();
  const stale = [...defs.values()].filter((d) => {
    const last = attempts.get(d.key);
    return isStale(last ? new Date(last) : null, now, env.NEWS_REFRESH_HOUR_IST) && canRetry(d.key);
  });

  for (const def of stale) {
    await refreshFeed(def);
    await sleep(1500);
  }
  return { checked: defs.size, refreshed: stale.length };
}