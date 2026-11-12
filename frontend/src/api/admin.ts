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
