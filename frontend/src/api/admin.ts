// frontend/src/api/admin.ts
// Internal admin pages. The server decides everything; this only asks.
import { apiFetch, ApiError } from './client';

export type AdminRole = 'FOUNDER' | 'COFOUNDER' | 'SALES' | 'TECH';
export type AdminSection = 'founder' | 'sales' | 'tech';

export interface AdminMe {
  role: AdminRole;
  sections: AdminSection[];
}

// null = not an admin (the server answers 404, exactly as for a page that doesn't exist).
export async function fetchAdminMe(): Promise<AdminMe | null> {
  try {
    return await apiFetch<AdminMe>('/api/admin/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function fetchAdminSection(section: AdminSection) {
  return apiFetch<{ section: AdminSection; ok: boolean }>(`/api/admin/${section}`);
}

// ── Founder overview (Slice 1) ───────────────────────────────────────────
export interface FounderPeriod {
  tickets: number; // every queue entry created (QR + walk-in)
  walkIn: number;
  qr: number;
  served: number; // completed
}

export interface FounderOverview {
  today: string; // YYYY-MM-DD, India time
  weekStart: string;
  monthStart: string;
  salons: { total: number; newThisMonth: number; active7d: number };
  periods: {
    today: FounderPeriod & { ticketsYesterday: number };
    week: FounderPeriod;
    month: FounderPeriod;
  };
  days: { date: string; tickets: number; served: number }[]; // last 30 days, oldest first
}

export function fetchFounderOverview() {
  return apiFetch<{ overview: FounderOverview }>('/api/admin/founder/overview').then((r) => r.overview);
}

// ── Founder salon management (Slice 2) ───────────────────────────────────
export interface AdminSalonSummary {
  id: string;
  name: string;
  phone: string;
  address: string;
  createdAt: string;
  isInternal: boolean;
  isSuspended: boolean;
  owner: { name: string; email: string | null; phone: string | null } | null;
  staffCount: number;
}

export interface AdminStaff {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
}

export interface AdminSalonDetail extends AdminSalonSummary {
  suspendedAt: string | null;
  staff: AdminStaff[];
}

export interface AdminCreateSalonInput {
  salonName: string;
  ownerName: string;
  email: string;
  password: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
  openingTime: string;
  closingTime: string;
  averageServiceMinutes: number;
  isInternal: boolean;
}

const F = '/api/admin/founder';

export function fetchAdminSalons(search?: string) {
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiFetch<{ salons: AdminSalonSummary[] }>(`${F}/salons${q}`).then((r) => r.salons);
}

export function fetchAdminSalon(salonId: string) {
  return apiFetch<{ salon: AdminSalonDetail }>(`${F}/salons/${salonId}`).then((r) => r.salon);
}

export function createAdminSalon(input: AdminCreateSalonInput) {
  return apiFetch<{ salonId: string; ownerStaffId: string }>(`${F}/salons`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function setSalonSuspended(salonId: string, suspended: boolean) {
  return apiFetch<{ salon: { id: string; isSuspended: boolean } }>(`${F}/salons/${salonId}/suspension`, {
    method: 'POST',
    body: JSON.stringify({ suspended }),
  });
}

export function setSalonInternal(salonId: string, isInternal: boolean) {
  return apiFetch<{ salon: { id: string; isInternal: boolean } }>(`${F}/salons/${salonId}/internal`, {
    method: 'POST',
    body: JSON.stringify({ isInternal }),
  });
}

export function resetStaffPassword(staffId: string, founderPassword: string, newPassword: string) {
  return apiFetch<{ ok: boolean }>(`${F}/staff/${staffId}/password`, {
    method: 'POST',
    body: JSON.stringify({ founderPassword, newPassword }),
  });
}

export function deleteAdminSalon(salonId: string, confirmName: string) {
  return apiFetch<{ ok: boolean }>(`${F}/salons/${salonId}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmName }),
  });
}

// ── Sales tab (Slice 4) ───────────────────────────────────────────────────
export interface SalesSalon {
  id: string;
  name: string;
  phone: string;
  address: string;
  area: string;
  createdAt: string;
  isSuspended: boolean;
  owner: { name: string | null; email: string | null; phone: string | null };
  lastTicketAt: string | null;
  daysSinceLastTicket: number | null; // null = never had a ticket
  tickets7d: number;
  avgPerDay7d: number;
  ticketsThisMonth: number;
  churnRisk: boolean;
  isPartner: boolean;
  notes: string;
  infoUpdatedAt: string | null;
}

export interface SalesArea {
  area: string;
  salons: number;
  activeSalons7d: number;
  ticketsThisMonth: number;
}

export interface SalesActivity {
  today: string;
  salons: SalesSalon[]; // churn risk first
  areas: SalesArea[];
}

export function fetchSalesActivity() {
  return apiFetch<SalesActivity>('/api/admin/sales/activity');
}

export function updateSalesInfo(salonId: string, patch: { isPartner?: boolean; notes?: string }) {
  return apiFetch<{ info: { salonId: string; isPartner: boolean; notes: string } }>(
    `/api/admin/sales/salons/${salonId}/info`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

// ── Tech tab: health panel (Slice 7) ──────────────────────────────────────
export type CheckStatus = 'ok' | 'late' | 'failing' | 'unknown';

export interface TechJob {
  name: 'sweeper' | 'cleanup' | 'news' | 'pinger';
  label: string;
  schedule: string;
  note: string | null;
  status: CheckStatus;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
  detail: Record<string, number | string>;
}

export interface TechHealth {
  checkedAt: string;
  database: { status: CheckStatus; responseMs: number | null; errorCode: string | null };
  jobs: TechJob[];
  sockets: number | null;
  server: {
    startedAt: string;
    uptimeSeconds: number;
    memoryMb: number;
    heapUsedMb: number;
    nodeVersion: string;
    environment: string;
  };
  build: { commit: string | null; branch: string | null };
}

export function fetchTechHealth() {
  return apiFetch<TechHealth>('/api/admin/tech/health');
}

// ── Tech tab: error and sign-in log (Slice 8) ─────────────────────────────
export interface EventGroup {
  kind: 'error' | 'auth' | 'rate_limit';
  code: string;
  route: string | null;
  count: number;
  lastAt: string;
  accounts: number; // distinct staff accounts (sign-in problems only)
}

export interface EventSummary {
  days: 1 | 7;
  total: number;
  truncated: boolean;
  errors: EventGroup[];
  auth: EventGroup[];
  rateLimits: EventGroup[];
  recent: { id: number; at: string; kind: EventGroup['kind']; code: string; route: string | null; status: number | null }[];
}

export function fetchTechEvents(days: 1 | 7) {
  return apiFetch<EventSummary>(`/api/admin/tech/events?days=${days}`);
}

// ── Founder: team and audit log (Slice 3) ─────────────────────────────────
export interface TeamMember {
  staffId: string;
  role: AdminRole;
  grantedAt: string;
  note: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  salonId: string | null;
  salonName: string | null;
  salonIsInternal: boolean | null;
  isYou: boolean;
}

export function fetchTeam() {
  return apiFetch<{ admins: TeamMember[] }>('/api/admin/founder/team').then((r) => r.admins);
}

export function grantAdminRole(input: { identifier: string; role: 'COFOUNDER' | 'SALES' | 'TECH'; markSalonInternal: boolean; note?: string }) {
  return apiFetch<{ staffId: string; role: AdminRole }>('/api/admin/founder/team', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revokeAdminRole(staffId: string) {
  return apiFetch<{ ok: boolean }>(`/api/admin/founder/team/${staffId}`, { method: 'DELETE' });
}

export type AuditGroup = 'salon' | 'staff' | 'sales' | 'admin' | 'tech';

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  actor: { name: string; email: string | null; role: string };
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
}

export function fetchAudit(opts: { group?: AuditGroup; before?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.group) q.set('group', opts.group);
  if (opts.before) q.set('before', String(opts.before));
  const s = q.toString();
  return apiFetch<{ entries: AuditEntry[]; nextBefore: number | null }>(`/api/admin/founder/audit${s ? `?${s}` : ''}`);
}

// ── Sales: onboarding funnel (Slice 5) ────────────────────────────────────
export type OnboardingPeriod = '30' | '90' | 'all';
export type OnboardingStepId = 'services' | 'first_ticket' | 'first_qr' | 'active';

export interface OnboardingSalon {
  id: string;
  name: string;
  area: string;
  createdAt: string;
  isSuspended: boolean;
  owner: { name: string | null; phone: string | null; email: string | null };
  reached: Record<OnboardingStepId, boolean>;
  eligibleForActive: boolean; // registered at least 7 days ago
  nextStep: OnboardingStepId | null; // null = nothing missing (or too new to judge "active")
}

export interface OnboardingFunnel {
  period: OnboardingPeriod;
  registered: number;
  steps: { id: OnboardingStepId; label: string; count: number; outOf: number }[];
  medianDaysToFirstTicket: number | null;
  salons: OnboardingSalon[];
}

export function fetchSalesOnboarding(period: OnboardingPeriod) {
  return apiFetch<OnboardingFunnel>(`/api/admin/sales/onboarding?period=${period}`);
}

// ── Sales: leads (Slice 6) ────────────────────────────────────────────────
export type LeadStatus = 'new' | 'contacted' | 'demo' | 'interested' | 'not_interested' | 'converted';

export interface Lead {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  area: string;
  address: string;
  status: LeadStatus;
  followUpOn: string | null; // YYYY-MM-DD
  notes: string;
  salonId: string | null;
  salonName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LeadInput = Partial<Omit<Lead, 'id' | 'salonName' | 'createdAt' | 'updatedAt'>>;

export function fetchLeads() {
  return apiFetch<{ today: string; leads: Lead[] }>('/api/admin/sales/leads');
}

export function createLead(input: LeadInput & { name: string }) {
  return apiFetch<{ lead: Lead }>('/api/admin/sales/leads', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.lead);
}

export function updateLead(id: string, input: LeadInput) {
  return apiFetch<{ lead: Lead }>(`/api/admin/sales/leads/${id}`, { method: 'PATCH', body: JSON.stringify(input) }).then((r) => r.lead);
}

export function deleteLead(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/admin/sales/leads/${id}`, { method: 'DELETE' });
}

// ── Tech: queue health (Slice 9) ──────────────────────────────────────────
export interface QueueCheck {
  id: 'duplicate_tokens' | 'double_serving' | 'overdue_serving' | 'stale_active' | 'stuck_paused';
  label: string;
  serious: boolean;
  count: number;
  rows: Array<{
    salon_id: string;
    salon: string;
    date?: string;
    token?: number;
    tokens?: number[];
    copies?: number;
    serving?: number;
    minutes_over?: number;
    tickets?: number;
    waiting?: number;
    minutes_paused?: number;
  }>;
}

export interface QueueHealth {
  checkedAt: string;
  checks: QueueCheck[];
  pushToday: { qrTickets: number; withPush: number; gotClose: number; gotNext: number; gotTurn: number };
  pushDelivery: {
    today: PushDay;
    lastDays: PushDay[];
    total: { sent: number; expired: number; failed: number };
  };
}

export interface PushDay {
  day: string;
  sent: number;
  expired: number;
  failed: number;
  lastFailureCode: string | null;
}

export interface TechSalon {
  id: string;
  name: string;
  address: string;
  isInternal: boolean;
  isSuspended: boolean;
}

export interface ReadOnlyQueue {
  salon: { id: string; name: string; isOpen: boolean; isQueueActive: boolean; isSuspended: boolean; hours: string };
  date: string;
  queue: { status: string; nextToken: number; updatedAt: string } | null;
  entries: Array<{
    token: number;
    status: string;
    walkIn: boolean;
    line: number | null;
    joinedAt: string;
    startedAt: string | null;
    endsAt: string | null;
    completedAt: string | null;
    priority: boolean;
    durationMinutes: number | null;
    notifiedStage: number;
  }>;
}

export function fetchQueueHealth() {
  return apiFetch<QueueHealth>('/api/admin/tech/queues');
}

export function searchTechSalons(search: string) {
  return apiFetch<{ salons: TechSalon[] }>(`/api/admin/tech/salons?search=${encodeURIComponent(search)}`).then((r) => r.salons);
}

export function fetchReadOnlyQueue(salonId: string) {
  return apiFetch<ReadOnlyQueue>(`/api/admin/tech/salons/${salonId}/queue`);
}

// ── Tech: bug reports (Slice 10) ──────────────────────────────────────────
export type BugStatus = 'new' | 'investigating' | 'fixed' | 'wont_fix';

export interface BugReport {
  id: string;
  createdAt: string;
  kind: 'bug' | 'idea' | 'question';
  message: string;
  page: string | null;
  device: string | null;
  status: BugStatus;
  techNote: string;
  updatedAt: string;
  salonId: string | null;
  salonName: string | null;
  reporter: { name: string; contact: string | null } | null;
}

export function fetchBugs(status: 'open' | 'all') {
  return apiFetch<{ reports: BugReport[] }>(`/api/admin/tech/bugs?status=${status}`).then((r) => r.reports);
}

export function updateBug(id: string, patch: { status?: BugStatus; techNote?: string }) {
  return apiFetch<{ report: { id: string } }>(`/api/admin/tech/bugs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

// Slice 11: testing tools (internal salons only) and feature flags
export interface TestSalon {
  id: string;
  name: string;
  hours: string;
  isSuspended: boolean;
}

export interface AdminFlag {
  key: string;
  enabled: boolean;
  value: string;
  description: string;
  updatedAt: string;
}

export type TestAction = 'scan' | 'walk-in' | 'finish' | 'push' | 'clear';

export function fetchTestSalons() {
  return apiFetch<{ salons: TestSalon[] }>('/api/admin/tech/test-salons').then((r) => r.salons);
}

export function runTestAction(salonId: string, action: TestAction, body: { token?: number } = {}) {
  return apiFetch<{ token?: number; tokens?: number[]; ticketUrl?: string; cancelled?: number }>(
    `/api/admin/tech/test/${salonId}/${action}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function fetchFlags() {
  return apiFetch<{ flags: AdminFlag[] }>('/api/admin/tech/flags').then((r) => r.flags);
}

export function updateFlag(key: string, patch: { enabled?: boolean; value?: string }) {
  return apiFetch<{ ok: true }>(`/api/admin/tech/flags/${key}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

// ── Tech: code history (GitHub commits + live version) ────────────────────
export type CommitState = 'not_deployed' | 'live' | 'older' | 'unknown';

export interface CommitItem {
  sha: string;
  shortSha: string;
  message: string; // first line only
  author: string;
  date: string;
  url: string;
  state: CommitState;
}

export type GitHistory =
  | { configured: false; reason: string }
  | {
      configured: true;
      repo: string;
      branch: string;
      deployedCommit: string | null;
      deployedInList: boolean;
      notDeployed: number | null;
      fetchedAt: string;
      stale: boolean;
      warning: string | null;
      commits: CommitItem[];
    };

export function fetchGitHistory(refresh = false) {
  return apiFetch<GitHistory>(`/api/admin/tech/commits${refresh ? '?refresh=1' : ''}`);
}
