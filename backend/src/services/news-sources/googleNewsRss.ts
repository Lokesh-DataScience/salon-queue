// backend/src/services/news-sources/googleNewsRss.ts
import { XMLParser } from 'fast-xml-parser';
import { env } from '../../config/env';
import type { FeedSource, NewsItem } from './types';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && '#text' in v) return String((v as Record<string, unknown>)['#text']);
  return '';
};

export const googleNewsRss: FeedSource = {
  name: 'google-news-rss',
  async fetch(query: string): Promise<NewsItem[]> {
    const q = `${query} when:${env.NEWS_WINDOW_DAYS}d`;
    const url =
      'https://news.google.com/rss/search' +
      `?q=${encodeURIComponent(q)}&hl=${encodeURIComponent(env.NEWS_GOOGLE_HL)}` +
      `&gl=IN&ceid=${encodeURIComponent(env.NEWS_GOOGLE_CEID)}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': env.OUTBOUND_USER_AGENT, Accept: 'application/rss+xml, application/xml' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`news source status ${res.status}`);

    const doc = parser.parse(await res.text());
    const seen = new Set<string>();
    const items: NewsItem[] = [];

    for (const raw of asArray<Record<string, unknown>>(doc?.rss?.channel?.item)) {
      const link = text(raw.link);
      let title = text(raw.title).trim();
      const source = text(raw.source).trim() || null;
      if (!title || !/^https?:\/\//i.test(link)) continue;
      // Google appends " - Publisher" to titles; the publisher is shown separately.
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
      if (seen.has(title)) continue;
      seen.add(title);

      const published = new Date(text(raw.pubDate));
      items.push({
        title,
        url: link,
        source,
        publishedAt: Number.isNaN(published.getTime()) ? null : published.toISOString(),
      });
    }

    items.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    return items.slice(0, 12);
  },
};