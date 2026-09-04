import { apiFetch } from './client';

export function fetchNearbySalons(lat: number, lng: number, radiusKm = 5) {
  return apiFetch<{ salons: any[] }>(
    `/api/salons/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`
  ).then((r) => r.salons);
}

export function fetchSalon(salonId: string) {
  return apiFetch<{ salon: any }>(`/api/salons/${salonId}`).then((r) => r.salon);
}

export function fetchSalonQueue(salonId: string) {
  return apiFetch<{ currentToken: number; waitingCount: number }>(
    `/api/salons/${salonId}/queue`
  );
}