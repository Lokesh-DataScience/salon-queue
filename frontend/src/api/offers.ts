// frontend/src/api/offers.ts
import { apiFetch } from './client';

export interface Offer {
  id: string;
  name: string;
  dailyCount: number;
  active: boolean;
  redeemedToday: number;
}

export function fetchOffers() {
  return apiFetch<{ offers: Offer[]; totalRedeemedToday: number; expectedCustomers: number | null }>(
    '/api/barber/offers',
  );
}

export function setExpectedCustomers(expectedCustomers: number | null) {
  return apiFetch<{ expectedCustomers: number | null }>('/api/barber/offers/expected', {
    method: 'PATCH',
    body: JSON.stringify({ expectedCustomers }),
  });
}

export function createOffer(input: { name: string; dailyCount: number }) {
  return apiFetch<{ offer: Offer }>('/api/barber/offers', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.offer);
}

export function updateOffer(
  id: string,
  patch: { name?: string; dailyCount?: number; active?: boolean },
) {
  return apiFetch<{ offer: Offer }>(`/api/barber/offers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then((r) => r.offer);
}

export function deleteOffer(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/barber/offers/${id}`, { method: 'DELETE' });
}

export function redeemCode(code: string) {
  return apiFetch<{ prizeName: string }>('/api/barber/offers/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}