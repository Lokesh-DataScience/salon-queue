// backend/src/services/founderTeam.service.ts
// Founder-only: who has admin access, give/remove SALES or TECH, and read the audit log.
// FOUNDER itself is only ever granted in Supabase, and nobody can change their own role here.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { normalizePhone } from '../utils/phone';
import { logAdminAction, type AdminRole } from './admin.service';
import type { Actor } from './founderSalons.service';

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

interface RoleRow {
  staff_id: string;
  role: AdminRole;
  granted_at: string;
  note: string | null;
  salon_staff: unknown; // { name, email, phone, salon_id, salons: { name, is_internal } }
}

export async function listAdmins(actor: Actor) {
  const { data, error } = await supabase
    .from('staff_admin_roles')
    .select('staff_id, role, granted_at, note, salon_staff(name, email, phone, salon_id, salons(name, is_internal))')
    .order('granted_at', { ascending: true });
  if (error) throw error;

  return ((data ?? []) as RoleRow[]).map((r) => {
    const st = one(r.salon_staff as never) as
      | { name: string; email: string | null; phone: string | null; salon_id: string; salons: unknown }
      | null;
    const salon = one(st?.salons as never) as { name: string; is_internal: boolean } | null;
    return {
      staffId: r.staff_id,
      role: r.role,
      grantedAt: r.granted_at,
      note: r.note,
      name: st?.name ?? null,
      email: st?.email ?? null,
      phone: st?.phone ?? null,
      salonId: st?.salon_id ?? null,
      salonName: salon?.name ?? null,
      salonIsInternal: salon?.is_internal ?? null,
      isYou: r.staff_id === actor.staffId,
    };
  });
}

async function findStaff(identifier: string) {
  const isEmail = identifier.includes('@');
  const value = isEmail ? identifier.toLowerCase() : normalizePhone(identifier);
  if (!value) throw new AppError('Enter the email or phone number the person signs in with.', 400);

  const { data, error } = await supabase
    .from('salon_staff')
    .select('id, name, salon_id')
    .eq(isEmail ? 'email' : 'phone', value)
    .limit(2);
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new AppError('No account signs in with that. Ask them to register their salon first.', 404);
  }
  if (data.length > 1) throw new AppError('More than one account matches. Use their email instead.', 409);
  return data[0] as { id: string; name: string; salon_id: string };
}

async function currentRole(staffId: string): Promise<AdminRole | null> {
  const { data, error } = await supabase.from('staff_admin_roles').select('role').eq('staff_id', staffId).maybeSingle();
  if (error) throw error;
  return (data?.role as AdminRole | undefined) ?? null;
}

export async function grantAdmin(
  actor: Actor,
  input: { identifier: string; role: 'SALES' | 'TECH'; markSalonInternal: boolean; note?: string },
) {
  const staff = await findStaff(input.identifier);
  if (staff.id === actor.staffId) throw new AppError("You can't change your own role.", 409);
  const existing = await currentRole(staff.id);
  if (existing === 'FOUNDER') throw new AppError('Founder access can only be changed in Supabase.', 409);

  const { error } = await supabase
    .from('staff_admin_roles')
    .upsert({ staff_id: staff.id, role: input.role, note: input.note ?? null, granted_at: new Date().toISOString() });
  if (error) throw error;

  if (input.markSalonInternal) {
    const { error: sErr } = await supabase.from('salons').update({ is_internal: true }).eq('id', staff.salon_id);
    if (sErr) throw sErr;
  }

  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'admin.grant',
    targetType: 'staff',
    targetId: staff.id,
    details: { name: staff.name, role: input.role, previousRole: existing, salonMarkedInternal: input.markSalonInternal },
  });
  return { staffId: staff.id, role: input.role };
}

export async function revokeAdmin(actor: Actor, staffId: string) {
  if (staffId === actor.staffId) throw new AppError("You can't remove your own access.", 409);
  const existing = await currentRole(staffId);
  if (!existing) throw new AppError('That account has no admin access.', 404);
  if (existing === 'FOUNDER') throw new AppError('Founder access can only be changed in Supabase.', 409);

  const { error } = await supabase.from('staff_admin_roles').delete().eq('staff_id', staffId);
  if (error) throw error;

  const { data: st } = await supabase.from('salon_staff').select('name').eq('id', staffId).maybeSingle();
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'admin.revoke',
    targetType: 'staff',
    targetId: staffId,
    details: { name: st?.name ?? null, role: existing },
  });
}

const PAGE = 50;

export async function listAudit(opts: { group?: 'salon' | 'staff' | 'sales' | 'admin'; before?: number }) {
  let q = supabase
    .from('admin_audit_log')
    .select('id, created_at, actor_staff_id, actor_role, action, target_type, target_id, details, salon_staff(name, email)')
    .order('id', { ascending: false })
    .limit(PAGE + 1);
  if (opts.group) q = q.like('action', `${opts.group}.%`);
  if (opts.before) q = q.lt('id', opts.before);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: number;
    created_at: string;
    actor_staff_id: string | null;
    actor_role: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    details: Record<string, unknown> | null;
    salon_staff: unknown;
  }>;

  const page = rows.slice(0, PAGE).map((r) => {
    const actorRow = one(r.salon_staff as never) as { name: string; email: string | null } | null;
    return {
      id: r.id,
      at: r.created_at,
      action: r.action,
      actor: { name: actorRow?.name ?? 'Deleted account', email: actorRow?.email ?? null, role: r.actor_role },
      targetType: r.target_type,
      targetId: r.target_id,
      details: r.details ?? {},
    };
  });
  return { entries: page, nextBefore: rows.length > PAGE ? page[page.length - 1].id : null };
}
