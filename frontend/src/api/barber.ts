// frontend/src/api/barber.ts
import { apiFetch } from './client';

export interface BarberStaff {
  id: string;
  name: string;
  email: string | null; // staff added by the owner sign in with a phone number instead
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
  join_source?: 'qr' | 'app'; // 'app' = took the token from the customer app (may not be at the salon yet)
  not_here_count?: number; // times the barber pressed "Not here" for this ticket
  // From this salon's own customer list. null for a walk-in, or if the customer was removed.
  customer_name: string | null;
  customer_phone: string | null;
  prize?: { name: string; redeemed: boolean } | null; // only on the called/serving customer
}

// One barber's line, as the owner's switcher shows it.
export interface BarberLaneSummary {
  id: string;
  name: string;
  isMine: boolean;
  isPaused: boolean;
  waitingCount: number;
  busy: boolean;
}

export interface BarberQueueSnapshot {
  salonId: string;
  queueStatus: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  currentToken: number;
  called: BarberQueueEntry | null;
  serving: BarberQueueEntry | null;
  waiting: BarberQueueEntry[];
  // Only present when the salon has more than one barber (a one-barber salon never sees these).
  lane?: { id: string; name: string; isPaused: boolean } | null;
  lanes?: BarberLaneSummary[] | null; // the owner's switcher; staff never get it
}

// The owner can look at another barber's line; for staff the server ignores this and uses their own.
const laneQuery = (laneId?: string) => (laneId ? `?laneId=${encodeURIComponent(laneId)}` : '');

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
  phone?: string; // add this line
}

export interface RegisterSalonInput {
  salonName: string;
  phone: string; // also the owner's login
  address: string;
  district?: string;
  state?: string;
  latitude?: number; // only when the barber allowed location
  longitude?: number;
  ownerName: string;
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
  allowAppJoin: boolean; // customers may take a token from the app (from home)
  // Days the salon is closed every week: 0 = Sunday ... 6 = Saturday. Missing or [] = open every day.
  weeklyOffDays?: number[];
}

export type SalonProfileUpdate = Partial<
  Pick<
    BarberSalonProfile,
    | 'name'
    | 'phone'
    | 'address'
    | 'openingTime'
    | 'closingTime'
    | 'averageServiceMinutes'
    | 'allowAppJoin'
    | 'weeklyOffDays'
  >
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

// identifier is an email address or a phone number.
export function loginBarber(identifier: string, password: string) {
  return apiFetch<{ staff: BarberStaff }>('/api/auth/barber/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export function logoutBarber() {
  return apiFetch<{ ok: boolean }>('/api/auth/barber/logout', { method: 'POST' });
}

export function fetchBarberQueue(laneId?: string) {
  return apiFetch<BarberQueueSnapshot>(`/api/barber/queue${laneQuery(laneId)}`);
}
 
export function callNextCustomer(laneId?: string) {
  return apiFetch<{ result: CallNextResult }>(`/api/barber/queue/next${laneQuery(laneId)}`, { method: 'POST' });
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

export function pauseQueue(laneId?: string) {
  return apiFetch<{ queue: { status: string } }>(`/api/barber/queue/pause${laneQuery(laneId)}`, { method: 'POST' });
}

export function resumeQueue(laneId?: string) {
  return apiFetch<{ queue: { status: string } }>(`/api/barber/queue/resume${laneQuery(laneId)}`, { method: 'POST' });
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

export function addWalkIn(laneId?: string) {
  return apiFetch<{ entry: { id: string; tokenNumber: number; laneName?: string | null } }>(
    `/api/barber/queue/walk-in${laneQuery(laneId)}`,
    { method: 'POST' },
  );
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
  priceRupees?: number | null; // whole rupees; null = not shown to customers
}

export interface ServiceInput {
  name: string;
  durationMinutes: number;
  priceRupees?: number | null;
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

// An app customer who is not at the salon: first time back 2 places, second time cancelled.
export function markNotHere(entryId: string) {
  return apiFetch<{ entry: { id: string; action: 'moved_back' | 'cancelled'; tokenNumber: number } }>(
    `/api/barber/queue/${entryId}/not-here`,
    { method: 'POST' },
  );
}

export function prioritizeEntry(entryId: string) {
  return apiFetch<{ entry: { id: string; tokenNumber: number } }>(
    `/api/barber/queue/${entryId}/prioritize`,
    { method: 'POST' },
  );
}

// ── Who is signed in, and the owner's team list ───────────────────────────
export interface BarberMe {
  id: string;
  name: string;
  role: 'OWNER' | 'BARBER' | 'MANAGER';
  salonId: string;
  laneId: string | null;
  laneName: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: 'OWNER' | 'BARBER' | 'MANAGER';
  isActive: boolean;
  laneId: string | null;
}

export interface AddTeamMemberInput {
  name: string;
  phone: string;
  password: string;
}

export function fetchMe() {
  return apiFetch<{ staff: BarberMe }>('/api/barber/me').then((r) => r.staff);
}

export function fetchTeam() {
  return apiFetch<{ team: TeamMember[] }>('/api/barber/team').then((r) => r.team);
}

export function addTeamMember(input: AddTeamMemberInput) {
  return apiFetch<{ member: TeamMember }>('/api/barber/team', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.member);
}

export function resetTeamMemberPassword(staffId: string, password: string) {
  return apiFetch<{ ok: boolean }>(`/api/barber/team/${staffId}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export function setTeamMemberActive(staffId: string, isActive: boolean) {
  return apiFetch<{ member: { id: string; isActive: boolean } }>(`/api/barber/team/${staffId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
}

// Any signed-in staff member changes their own password.
export function changeOwnPassword(currentPassword: string, newPassword: string) {
  return apiFetch<{ ok: boolean }>('/api/barber/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
// ── The salon's own customer list (owner only) ───────────────────────────
export interface SalonCustomer {
  id: string;
  name: string;
  phone: string; // 10 digits
  firstVisitAt: string;
  lastVisitAt: string;
  visitCount: number;
}

export function fetchCustomers(search?: string) {
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiFetch<{ customers: SalonCustomer[] }>(`/api/barber/customers${q}`).then((r) => r.customers);
}

export function deleteCustomer(customerId: string) {
  return apiFetch<{ ok: boolean }>(`/api/barber/customers/${customerId}`, { method: 'DELETE' });
}

export function redeemPrizeForEntry(entryId: string) {
  return apiFetch<{ prizeName: string }>(`/api/barber/queue/${entryId}/redeem-prize`, { method: 'POST' });
}
