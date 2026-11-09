// frontend/src/api/salons.ts
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

// Resolves the code printed in a salon's wall QR to the salon (id + name only).
export function fetchSalonByCode(code: string) {
  return apiFetch<{ salon: { id: string; name: string } }>(
    `/api/salons/by-code/${encodeURIComponent(code)}`
  ).then((r) => r.salon);
}

// A barber's line, as a customer sees it. Salons with one barber return one entry.
export interface PublicLane {
  id: string;
  name: string;
  waitingCount: number;
  estimatedWaitMinutes: number;
  isPaused?: boolean; // on a break: listed, but not selectable
}

export function fetchSalonLanes(salonId: string) {
  return apiFetch<{ lanes: PublicLane[] }>(`/api/salons/${salonId}/lanes`).then((r) => r.lanes);
}
