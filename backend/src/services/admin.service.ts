// backend/src/services/admin.service.ts
// Internal admin access. A staff account is an admin only while it has a row in
// staff_admin_roles. That table is written by hand in Supabase (and later by the
// Founder tab) — never by any barber endpoint.
import { supabase } from '../config/supabase';

export const ADMIN_ROLES = ['FOUNDER', 'SALES', 'TECH'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_SECTIONS = ['founder', 'sales', 'tech'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

const SECTION_ROLE: Record<AdminSection, AdminRole> = {
  founder: 'FOUNDER',
  sales: 'SALES',
  tech: 'TECH',
};

// FOUNDER sees every section; everyone else only their own.
export function sectionsFor(role: AdminRole): AdminSection[] {
  if (role === 'FOUNDER') return [...ADMIN_SECTIONS];
  return ADMIN_SECTIONS.filter((s) => SECTION_ROLE[s] === role);
}

// Read from the database on EVERY admin request (never from the JWT), so removing
// the row cuts access on the very next request, without waiting for a token to expire.
export async function getAdminRole(staffId: string): Promise<AdminRole | null> {
  const { data, error } = await supabase
    .from('staff_admin_roles')
    .select('role')
    .eq('staff_id', staffId)
    .maybeSingle();

  if (error) throw error;
  const role = data?.role as string | undefined;
  return role && (ADMIN_ROLES as readonly string[]).includes(role) ? (role as AdminRole) : null;
}

export interface AdminActionLog {
  actorStaffId: string;
  actorRole: AdminRole;
  action: string; // e.g. 'salon.suspend'
  targetType?: string; // e.g. 'salon'
  targetId?: string;
  details?: Record<string, unknown>; // never passwords, never customer data
}

// Every admin action that changes data calls this. If the log can't be written the
// action should fail too, so call it before (or in the same step as) the change.
export async function logAdminAction(entry: AdminActionLog) {
  const { error } = await supabase.from('admin_audit_log').insert({
    actor_staff_id: entry.actorStaffId,
    actor_role: entry.actorRole,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    details: entry.details ?? {},
  });
  if (error) throw error;
}
