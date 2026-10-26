// frontend/src/api/barber.ts
import { apiFetch } from './client';

export interface BarberStaff {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'BARBER' | 'MANAGER';
  salonId: string;
}

export interface BarberQueueEntry {
  id: string;
  token_number: number;
  status: 'CALLED' | 'SERVING' | 'WAITING';
  joined_at: string;
  called_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  skipped_at: string | null;
}

export interface BarberQueueSnapshot {
  salonId: string;
  queueStatus: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  currentToken: number;
  called: BarberQueueEntry | null;
  serving: BarberQueueEntry | null;
  waiting: BarberQueueEntry[];
}

export interface CallNextResult {
  completed_entry_id?: string | null;
  called_entry_id?: string | null;
  called_token_number?: number | null;
  nothingWaiting?: boolean;
}

export function loginBarber(email: string, password: string) {
  return apiFetch<{ staff: BarberStaff }>('/api/auth/barber/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function logoutBarber() {
  return apiFetch<{ ok: boolean }>('/api/auth/barber/logout', { method: 'POST' });
}

export function fetchBarberQueue() {
  return apiFetch<BarberQueueSnapshot>('/api/barber/queue');
}
 
export function callNextCustomer() {
  return apiFetch<{ result: CallNextResult }>('/api/barber/queue/next', { method: 'POST' });
}

export function startEntry(entryId: string) {
  return apiFetch<{ entry: { id: string; status: string } }>(`/api/barber/queue/${entryId}/start`, {
    method: 'POST',
  });
}

export function completeEntry(entryId: string) {
  return apiFetch<{ entry: { id: string; status: string } }>(`/api/barber/queue/${entryId}/complete`, {
    method: 'POST',
  });
}

export function skipEntry(entryId: string) {
  return apiFetch<{ entry: { id: string; status: string } }>(`/api/barber/queue/${entryId}/skip`, {
    method: 'POST',
  });
}

export function pauseQueue() {
  return apiFetch<{ queue: { status: string } }>('/api/barber/queue/pause', { method: 'POST' });
}

export function resumeQueue() {
  return apiFetch<{ queue: { status: string } }>('/api/barber/queue/resume', { method: 'POST' });
}

export interface BarberSalon {
  id: string;
  name: string;
  qrCode: string;
}

export function fetchBarberSalon() {
  return apiFetch<{ salon: BarberSalon }>('/api/barber/salon').then((r) => r.salon);
}
