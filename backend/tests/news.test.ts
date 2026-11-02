// backend/tests/news.test.ts
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from './helpers';
import { supabase } from '../src/config/supabase';
import { setNewsSource } from '../src/services/news.service';
import { googleNewsRss } from '../src/services/news-sources/googleNewsRss';
import { assignPlaceToSalon, normalizePlace } from '../src/services/place.service';
import { latestRefreshBoundary, isStale } from '../src/utils/refreshWindow';
import type { FeedSource, NewsItem } from '../src/services/news-sources/types';

const tag = randomUUID().slice(0, 8);
const salonIds: string[] = [];

afterAll(async () => {
  setNewsSource(googleNewsRss);
  if (salonIds.length) await supabase.from('salons').delete().in('id', salonIds);
  await supabase.from('news_feeds').delete().like('feed_key', `%${tag}%`); // items cascade
  await supabase.from('places').delete().like('place_key', `%${tag}%`);
});

async function newSalon() {
  const { data, error } = await supabase
    .from('salons')
    .insert({
      name: 'News Test Salon', phone: '9876543210', address: '1 Test Road',
      latitude: 22.35, longitude: 82.68, opening_time: '09:00', closing_time: '21:00',
      average_service_minutes: 15,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error('salon insert failed');
  salonIds.push(data.id);
  return data.id as string;
}

function fakeSource(impl?: (q: string) => Promise<NewsItem[]>) {
  const calls: string[] = [];
  const source: FeedSource = {
    name: 'fake',
    async fetch(q) {
      calls.push(q);
      if (impl) return impl(q);
      return [{ title: `Headline for ${q}`, url: `https://example.test/${encodeURIComponent(q)}`, source: 'Example', publishedAt: new Date().toISOString() }];
    },
  };
  return { source, calls };
}

const place = (n: string) => ({ district: `district-${n}-${tag}`, state: `state-${n}-${tag}` });

beforeEach(() => setNewsSource(googleNewsRss));

describe('refresh window', () => {
  it('finds the latest 06:00 IST boundary', () => {
    expect(latestRefreshBoundary(new Date('2026-11-01T02:00:00Z'), 6).toISOString()).toBe('2026-11-01T00:30:00.000Z');
    expect(latestRefreshBoundary(new Date('2026-11-01T00:00:00Z'), 6).toISOString()).toBe('2026-10-31T00:30:00.000Z');
  });
  it('is stale only if not attempted since that boundary', () => {
    const now = new Date('2026-11-01T02:00:00Z');
    expect(isStale(null, now, 6)).toBe(true);
    expect(isStale(new Date('2026-10-31T20:00:00Z'), now, 6)).toBe(true);
    expect(isStale(new Date('2026-11-01T01:00:00Z'), now, 6)).toBe(false);
  });
});

describe('places', () => {
  it('spelling and spacing variants of one area share one place', async () => {
    expect(normalizePlace({ district: '  Korba ', state: 'Chhattisgarh' }).key)
      .toBe(normalizePlace({ district: 'KORBA', state: ' chhattisgarh' }).key);

    const p = place('same');
    const [a, b] = [await newSalon(), await newSalon()];
    const idA = await assignPlaceToSalon(a, p);
    const idB = await assignPlaceToSalon(b, { ...p, district: `  ${p.district.toUpperCase()} ` });
    expect(idB).toBe(idA);
    const { count } = await supabase.from('places').select('*', { count: 'exact', head: true }).like('place_key', `%same-${tag}%`);
    expect(count).toBe(1);
  });
});

describe('GET /api/salons/:salonId/feed', () => {
  it('many salons in one area cause exactly one fetch per shared feed', async () => {
    const { source, calls } = fakeSource();
    setNewsSource(source);
    const p = place('shared');
    const ids = [await newSalon(), await newSalon(), await newSalon()];
    for (const id of ids) await assignPlaceToSalon(id, p);

    const wave = () => Promise.all([...ids, ...ids, ...ids].map((id) => request(app).get(`/api/salons/${id}/feed`)));
    const first = await wave();
    for (const r of first) {
      expect(r.status).toBe(200);
      expect(r.body.items.length).toBe(2); // district + state
    }
    expect(calls.length).toBe(2);

    await wave();
    expect(calls.length).toBe(2); // cached: no new fetches
  });

  it('returns only public fields', async () => {
    setNewsSource(fakeSource().source);
    const id = await newSalon();
    await assignPlaceToSalon(id, place('fields'));
    const res = await request(app).get(`/api/salons/${id}/feed`);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['kind', 'publishedAt', 'scope', 'source', 'title', 'url']);
    expect(res.body.items[0].kind).toBe('news');
  });

  it('a failing source gives an empty list, not an error, and is not retried immediately', async () => {
    const { source, calls } = fakeSource(async () => { throw new Error('down'); });
    setNewsSource(source);
    const id = await newSalon();
    await assignPlaceToSalon(id, place('fail'));

    const r1 = await request(app).get(`/api/salons/${id}/feed`);
    expect(r1.status).toBe(200);
    expect(r1.body.items).toEqual([]);
    const after = calls.length;
    const r2 = await request(app).get(`/api/salons/${id}/feed`);
    expect(r2.status).toBe(200);
    expect(calls.length).toBe(after); // cooldown
  });

  it('a salon with no place gets an empty list; unknown or malformed ids get 404', async () => {
    const id = await newSalon();
    expect((await request(app).get(`/api/salons/${id}/feed`)).body.items).toEqual([]);
    expect((await request(app).get(`/api/salons/${randomUUID()}/feed`)).status).toBe(404);
    expect((await request(app).get('/api/salons/not-a-uuid/feed')).status).toBe(404);
  });
});

describe('registration with an place', () => {
  it('links the new salon to a place', async () => {
    const p = place('reg');
    const res = await request(app).post('/api/auth/barber/register').send({
      salonName: 'Reg Area Salon', phone: '9876543210', address: '12 Main Road, Korba',
      latitude: 22.35, longitude: 82.68, ownerName: 'Owner',
      email: `news-${randomUUID()}@example.test`, password: 'a-long-enough-pass', ...p,
    });
    expect(res.status).toBe(201);
    salonIds.push(res.body.staff.salonId);
    const { data } = await supabase.from('salons').select('place_id').eq('id', res.body.staff.salonId).single();
    expect(data?.place_id).toBeTruthy();
  });
});

describe('GET /api/geo/reverse', () => {
  it('rejects out-of-range coordinates without calling anything', async () => {
    expect((await request(app).get('/api/geo/reverse?lat=999&lng=0')).status).toBe(400);
  });
});