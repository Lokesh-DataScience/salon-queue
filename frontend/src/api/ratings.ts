// frontend/src/api/ratings.ts
// Customer app polish, slice 5: 1–5 star ratings of a finished visit.
import { apiFetch } from './client';

export interface MyRating {
  stars: number | null;
  canRate: boolean; // completed, and within 7 days
}

export function fetchMyRating(ticketId: string, accessToken: string) {
  return apiFetch<MyRating>(`/api/queue-tickets/${ticketId}/rating`, {
    headers: { 'X-Ticket-Token': accessToken }, // header, never the URL
  });
}

export function rateVisit(ticketId: string, accessToken: string, stars: number) {
  return apiFetch<{ stars: number }>(`/api/queue-tickets/${ticketId}/rating`, {
    method: 'POST',
    body: JSON.stringify({ accessToken, stars }),
  });
}

// Barber Settings → Profile: the owner's own numbers, even below the public minimum.
export interface OwnerRating {
  count: number;
  average: number | null;
  byStars: Record<'1' | '2' | '3' | '4' | '5', number>;
  minPublic: number;
  publiclyVisible: boolean;
}

export function fetchOwnerRating() {
  return apiFetch<OwnerRating>('/api/barber/rating');
}
