import { describe, it, expect, vi, afterEach } from 'vitest';
import { googleNewsRss } from '../src/services/news-sources/googleNewsRss';

const rss = (items: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;

const item = (title: string, link: string, pub: string, source = 'Dainik Bhaskar') =>
  `<item><title>${title}</title><link>${link}</link><guid isPermaLink="false">g</guid>` +
  `<pubDate>${pub}</pubDate><description>&lt;a href="${link}"&gt;x&lt;/a&gt;</description>` +
  `<source url="https://example.test">${source}</source></item>`;

const respond = (body: string, status = 200) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));

afterEach(() => vi.unstubAllGlobals());

describe('googleNewsRss', () => {
  it('parses real-shaped items: splits the publisher off, sorts newest first, drops duplicates and bad links', async () => {
    respond(
      rss(
        item('कोरबा में बिजली कटौती - Dainik Bhaskar', 'https://news.google.com/rss/articles/a', 'Sun, 01 Nov 2026 08:00:00 GMT') +
          item('Older story - Patrika', 'https://news.google.com/rss/articles/b', 'Sat, 31 Oct 2026 08:00:00 GMT', 'Patrika') +
          item('कोरबा में बिजली कटौती - Dainik Bhaskar', 'https://news.google.com/rss/articles/c', 'Sun, 01 Nov 2026 07:00:00 GMT') +
          item('Bad link', 'javascript:alert(1)', 'Sun, 01 Nov 2026 06:00:00 GMT'),
      ),
    );
    const items = await googleNewsRss.fetch('Korba Chhattisgarh');
    expect(items.map((i) => i.title)).toEqual(['कोरबा में बिजली कटौती', 'Older story']);
    expect(items[0].source).toBe('Dainik Bhaskar');
    expect(items[0].url).toBe('https://news.google.com/rss/articles/a');
    expect(items[0].publishedAt).toBe('2026-11-01T08:00:00.000Z');
  });

  it('handles a single item, which XML parsers return as an object not an array', async () => {
    respond(rss(item('Only one - Patrika', 'https://news.google.com/rss/articles/x', 'Sun, 01 Nov 2026 08:00:00 GMT', 'Patrika')));
    expect(await googleNewsRss.fetch('q')).toHaveLength(1);
  });

  it('an empty channel (no results) is an empty list, not an error', async () => {
    respond(rss(''));
    expect(await googleNewsRss.fetch('q')).toEqual([]);
  });

  it('builds the search URL from the query and throws on a bad status', async () => {
    respond(rss(''));
    await googleNewsRss.fetch('Korba Chhattisgarh');
    const called = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(called).toContain('q=Korba%20Chhattisgarh%20when%3A');
    expect(called).toContain('hl=hi');

    respond('nope', 429);
    await expect(googleNewsRss.fetch('q')).rejects.toThrow();
  });
});