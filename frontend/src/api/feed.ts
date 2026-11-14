// frontend/src/api/feed.ts
import { apiFetch } from './client';

export interface FeedItem {
  kind: 'news'; // later: 'featured' | 'sponsored'
  scope: 'district' | 'state';
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
}

export interface GeoPlace {
  district: string | null;
  state: string | null;
  address?: string | null; // street/area line, once /api/geo/reverse returns it
}

export function fetchSalonFeed(salonId: string) {
  return apiFetch<{ items: FeedItem[] }>(`/api/salons/${salonId}/feed`).then((r) => r.items);
}

export function reverseGeocode(lat: number, lng: number) {
  return apiFetch<{ place: GeoPlace }>(`/api/geo/reverse?lat=${lat}&lng=${lng}`).then((r) => r.place);
}