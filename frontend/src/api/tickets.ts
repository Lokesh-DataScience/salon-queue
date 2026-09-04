import { apiFetch } from './client';

export function joinSalonQueue(salonId: string, name: string, phone: string) {
  return apiFetch<{ ticket: any }>(`/api/queues/${salonId}/join`, {
    method: 'POST',
    body: JSON.stringify({ name, phone }),
  }).then((r) => r.ticket);
}

export function fetchTicketStatus(ticketId: string, accessToken: string) {
  return apiFetch<{ ticket: any }>(
    `/api/queue-tickets/${ticketId}?accessToken=${accessToken}`
  ).then((r) => r.ticket);
}