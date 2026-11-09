// frontend/src/api/tickets.ts
import { apiFetch } from './client';

// What the salon needs to know about the customer. First visit: name + phone + consent.
// Returning: just the salon's remember token.
export interface JoinCustomer {
  name?: string;
  phone?: string;
  consent?: boolean;
  rememberToken?: string;
}

// laneId = the barber's line. Leave it out for "Any barber" (the server picks the shortest wait).
export function joinSalonQueue(
  salonId: string,
  clientKey?: string,
  serviceIds?: string[],
  laneId?: string,
  customer?: JoinCustomer,
) {
  const body: Record<string, unknown> = {};
  if (clientKey) body.clientKey = clientKey;
  if (serviceIds?.length) body.serviceIds = serviceIds;
  if (laneId) body.laneId = laneId;
  if (customer?.name) body.name = customer.name;
  if (customer?.phone) body.phone = customer.phone;
  if (customer?.consent) body.consent = true;
  if (customer?.rememberToken) body.rememberToken = customer.rememberToken;
  return apiFetch<{ ticket: any }>(`/api/queues/${salonId}/join`, {
    method: 'POST',
    body: JSON.stringify(body),
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

// Removes this customer's name and number from the salon's list. The ticket itself stays.
export function forgetMyDetails(ticketId: string, accessToken: string) {
  return apiFetch<{ ok: boolean }>(`/api/queue-tickets/${ticketId}/forget-me`, {
    method: 'POST',
    body: JSON.stringify({ accessToken }),
  });
}