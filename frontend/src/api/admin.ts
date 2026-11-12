// frontend/src/api/admin.ts
// Internal admin pages. The server decides everything; this only asks.
import { apiFetch, ApiError } from './client';

export type AdminRole = 'FOUNDER' | 'SALES' | 'TECH';
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
