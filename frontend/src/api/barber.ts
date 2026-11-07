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
  priority_at: string | null;
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

export interface BarberSalon {
  id: string;
  name: string;
  qrCode: string;
}

export interface RegisterSalonInput {
  salonName: string;
  phone: string;
  address: string;
  area?: string;
  district?: string;
  state?: string;
  latitude: number;
  longitude: number;
  ownerName: string;
  email: string;
  password: string;
  openingTime: string;
  closingTime: string;
  averageServiceMinutes: number;
}

export interface BarberSalonProfile extends BarberSalon {
  phone: string;
  address: string;
  openingTime: string;
  closingTime: string;
  averageServiceMinutes: number;
}

export type SalonProfileUpdate = Partial<
  Pick<BarberSalonProfile, 'name' | 'phone' | 'address' | 'openingTime' | 'closingTime' | 'averageServiceMinutes'>
>;

export function fetchBarberSalonProfile() {
  return apiFetch<{ salon: BarberSalonProfile }>('/api/barber/salon').then((r) => r.salon);
}

export function updateBarberSalonProfile(changes: SalonProfileUpdate) {
  return apiFetch<{ salon: BarberSalonProfile }>('/api/barber/salon', {
    method: 'PATCH',
    body: JSON.stringify(changes),
  }).then((r) => r.salon);
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

export function fetchBarberSalon() {
  return apiFetch<{ salon: BarberSalon }>('/api/barber/salon').then((r) => r.salon);
}

export function registerSalon(input: RegisterSalonInput) {
  return apiFetch<{ staff: BarberStaff }>('/api/auth/barber/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function addWalkIn() {
  return apiFetch<{ entry: { id: string; tokenNumber: number } }>('/api/barber/queue/walk-in', {
    method: 'POST',
  });
}
export interface StatsDay {
  date: string; // YYYY-MM-DD, IST
  count: number;
}

export interface StatsPeriod {
  start: string;
  total: number;
  walkIn: number;
  qr: number;
  prevSamePeriod: number;
  days: StatsDay[];
}

export interface BarberStats {
  today: string;
  servedToday: number;
  walkInToday: number;
  qrToday: number;
  servedYesterday: number;
  week: StatsPeriod;
  month: StatsPeriod;
}

export function fetchBarberStats() {
  return apiFetch<{ stats: BarberStats }>('/api/barber/stats').then((r) => r.stats);
}

export interface SalonService {
  id: string;
  name: string;
  durationMinutes: number;
}

export interface ServiceInput {
  name: string;
  durationMinutes: number;
}

export function fetchServices() {
  return apiFetch<{ services: SalonService[] }>('/api/barber/services').then((r) => r.services);
}

export function createService(input: ServiceInput) {
  return apiFetch<{ service: SalonService }>('/api/barber/services', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.service);
}

export function updateService(id: string, changes: Partial<ServiceInput>) {
  return apiFetch<{ service: SalonService }>(`/api/barber/services/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  }).then((r) => r.service);
}

export function deleteService(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/barber/services/${id}`, { method: 'DELETE' });
}

export function prioritizeEntry(entryId: string) {
  return apiFetch<{ entry: { id: string; tokenNumber: number } }>(
    `/api/barber/queue/${entryId}/prioritize`,
    { method: 'POST' },
  );
}