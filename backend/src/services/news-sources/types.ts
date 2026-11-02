// backend/src/services/news-sources/types.ts
export interface NewsItem {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
}

// Swap this out (curated items, a paid API, a sponsored source) without touching the rest.
export interface FeedSource {
  readonly name: string;
  fetch(query: string): Promise<NewsItem[]>;
}