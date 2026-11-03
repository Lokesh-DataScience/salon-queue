// frontend/src/api/services.ts
import { apiFetch } from './client';

export interface PublicService {
  id: string;
  name: string;
}

export interface JoinedTicket {
  ticketId: string;
  accessToken: string;
  salonId?: string;
  tokenNumber: number;
  status: string;
}

export function fetchSalonServices(salonId: string) {
  return apiFetch<{ services: PublicService[] }>(`/api/queues/${salonId}/services`).then((r) => r.services);
}

// Same endpoint as the instant join, with the customer's choices. The key makes a retry safe.
export function joinWithServices(salonId: string, clientKey: string, serviceIds: string[]) {
  return apiFetch<{ ticket: JoinedTicket }>(`/api/queues/${salonId}/join`, {
    method: 'POST',
    body: JSON.stringify({ clientKey, serviceIds }),
  }).then((r) => r.ticket);
}