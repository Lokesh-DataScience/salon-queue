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

// The customer app's view of one salon (counts and token numbers only, never names or phones).
export interface PublicQueue {
  salonId: string;
  name: string;
  isOpen: boolean;
  isPaused: boolean;
  allowAppJoin: boolean;
  nowServingToken: number;
  waitingCount: number;
  estimatedWaitMinutes: number | null;
  lanes: PublicLane[] | null; // only when there is a choice of barber
  // The salon's own contact details (never anything about customers). Any of them can be missing.
  address?: string | null;
  phone?: string | null;
  openingTime?: string | null; // "HH:mm", India time
  closingTime?: string | null;
  location?: { lat: number; lng: number } | null;
}

export function fetchPublicQueue(salonId: string) {
  return apiFetch<{ salon: PublicQueue }>(`/api/salons/${salonId}/queue-public`).then((r) => r.salon);
}
