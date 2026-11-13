// frontend/src/api/publicServices.ts
import { apiFetch } from './client';

export interface PublicService {
  id: string;
  name: string;
  durationMinutes: number;
  priceRupees?: number | null; // null or missing = the salon hasn't set a price
}

export function fetchSalonServices(salonId: string) {
  return apiFetch<{ services: PublicService[] }>(`/api/salons/${salonId}/services`).then((r) => r.services);
}