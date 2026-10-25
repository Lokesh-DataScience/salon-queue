// frontend/src/api/tickets.ts
import { apiFetch } from './client';

export function joinSalonQueue(salonId: string) {
  return apiFetch<{ ticket: any }>(`/api/queues/${salonId}/join`, {
    method: 'POST',
    body: JSON.stringify({}),
  }).then((r) => r.ticket);
}

export function fetchTicketStatus(ticketId: string, accessToken: string) {
  return apiFetch<{ ticket: any }>(`/api/queue-tickets/${ticketId}`, {
    headers: { 'X-Ticket-Token': accessToken },
  }).then((r) => r.ticket);
}

export function leaveTicket(ticketId: string, accessToken: string) {
  // Token goes in the body, not the URL, so it stays out of logs and history.
  return apiFetch<{ ticket: { ticketId: string; status: string } }>(
    `/api/queue-tickets/${ticketId}/leave`,
    { method: 'POST', body: JSON.stringify({ accessToken }) },
  ).then((r) => r.ticket);
}