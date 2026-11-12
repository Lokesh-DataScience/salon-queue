// backend/src/services/founderSalons.service.ts
// Founder-only salon management. Every change is written to admin_audit_log.
// Never returns customer data: salons and their staff accounts only.
import bcrypt from 'bcrypt';
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { registerSalon } from './auth.service';
import { logAdminAction, type AdminRole } from './admin.service';
import { clearSessionCache } from './sessionState.service';
import type { RegisterSalonBody } from '../validators/auth.validators';

export interface Actor {
  staffId: string;
  salonId: string;
  role: AdminRole;
}

interface StaffRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  is_active: boolean;
}

interface SalonRow {
  id: string;
  name: string;
  phone: string;
  address: string;
  created_at: string;
  is_internal: boolean;
  is_suspended: boolean;
  suspended_at: string | null;
  salon_staff: StaffRow[] | null;
}

const SALON_COLUMNS =
  'id, name, phone, address, created_at, is_internal, is_suspended, suspended_at, salon_staff(id, name, email, phone, role, is_active)';

function toSummary(s: SalonRow) {
  const owner = (s.salon_staff ?? []).find((m) => m.role === 'OWNER') ?? null;
  return {
    id: s.id,
    name: s.name,
    phone: s.phone,
    address: s.address,
    createdAt: s.created_at,
    isInternal: s.is_internal,
    isSuspended: s.is_suspended,
    owner: owner ? { name: owner.name, email: owner.email, phone: owner.phone } : null,
    staffCount: (s.salon_staff ?? []).length,
  };
}

// PostgREST filter syntax uses , ( ) . : * % — keep the search to plain words.
function cleanSearch(raw?: string) {
  return (raw ?? '').replace(/[^\p{L}\p{N}\s@+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
}

export async function listSalons(search?: string) {
  let q = supabase.from('salons').select(SALON_COLUMNS).order('created_at', { ascending: false }).limit(200);
  const s = cleanSearch(search);
  if (s) q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,address.ilike.%${s}%`);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown as SalonRow[]).map(toSummary);
}

export async function getSalon(salonId: string) {
  const { data, error } = await supabase.from('salons').select(SALON_COLUMNS).eq('id', salonId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Salon not found.', 404);
  const s = data as unknown as SalonRow;
  return {
    ...toSummary(s),
    suspendedAt: s.suspended_at,
    staff: (s.salon_staff ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      phone: m.phone,
      role: m.role,
      isActive: m.is_active,
    })),
  };
}

export async function createSalon(actor: Actor, body: RegisterSalonBody, isInternal: boolean) {
  const { staff } = await registerSalon(body); // same rules as the public sign-up; its tokens are not used
  if (isInternal) {
    const { error } = await supabase.from('salons').update({ is_internal: true }).eq('id', staff.salonId);
    if (error) throw error;
  }
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'salon.create',
    targetType: 'salon',
    targetId: staff.salonId,
    details: { name: body.salonName, isInternal },
  });
  return { salonId: staff.salonId, ownerStaffId: staff.id };
}

export async function setSuspended(actor: Actor, salonId: string, suspended: boolean) {
  if (suspended && salonId === actor.salonId) {
    throw new AppError("You can't suspend the salon your own account belongs to.", 409);
  }
  const { data, error } = await supabase
    .from('salons')
    .update({ is_suspended: suspended, suspended_at: suspended ? new Date().toISOString() : null })
    .eq('id', salonId)
    .select('id, name')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Salon not found.', 404);
  clearSessionCache(); // takes effect on the barber's very next request
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: suspended ? 'salon.suspend' : 'salon.unsuspend',
    targetType: 'salon',
    targetId: salonId,
    details: { name: data.name },
  });
  return { id: salonId, isSuspended: suspended };
}

export async function setInternal(actor: Actor, salonId: string, isInternal: boolean) {
  const { data, error } = await supabase
    .from('salons')
    .update({ is_internal: isInternal })
    .eq('id', salonId)
    .select('id, name')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Salon not found.', 404);
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: isInternal ? 'salon.mark_internal' : 'salon.unmark_internal',
    targetType: 'salon',
    targetId: salonId,
    details: { name: data.name },
  });
  return { id: salonId, isInternal };
}

export async function resetStaffPassword(actor: Actor, staffId: string, founderPassword: string, newPassword: string) {
  if (staffId === actor.staffId) {
    throw new AppError('Use "Change password" in Settings for your own account.', 400);
  }

  // Re-check the founder's own password first. 403 (not 401) so the app doesn't treat it as a lost session.
  const { data: me, error: meError } = await supabase
    .from('salon_staff')
    .select('password_hash')
    .eq('id', actor.staffId)
    .maybeSingle();
  if (meError) throw meError;
  if (!me || !(await bcrypt.compare(founderPassword, me.password_hash as string))) {
    throw new AppError('Your password is incorrect.', 403);
  }

  const { data: target, error: targetError } = await supabase
    .from('salon_staff')
    .select('id, salon_id')
    .eq('id', staffId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new AppError('Account not found.', 404);

  const { error } = await supabase
    .from('salon_staff')
    .update({
      password_hash: await bcrypt.hash(newPassword, 12),
      sessions_valid_after: new Date().toISOString(), // signs this account out everywhere
    })
    .eq('id', staffId);
  if (error) throw error;
  clearSessionCache();

  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'staff.password_reset',
    targetType: 'staff',
    targetId: staffId,
    details: { salonId: target.salon_id }, // never the password
  });
}

export async function deleteSalon(actor: Actor, salonId: string, confirmName: string) {
  const { data: salon, error } = await supabase
    .from('salons')
    .select('id, name, is_internal')
    .eq('id', salonId)
    .maybeSingle();
  if (error) throw error;
  if (!salon) throw new AppError('Salon not found.', 404);
  if (salonId === actor.salonId) throw new AppError("You can't delete the salon your own account belongs to.", 409);
  if (!salon.is_internal) throw new AppError('Only internal (test or demo) salons can be deleted.', 409);
  if (confirmName.trim() !== (salon.name as string).trim()) {
    throw new AppError("The name you typed doesn't match the salon's name.", 400);
  }

  // Logged first, so the record survives even though the salon row is gone afterwards.
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'salon.delete',
    targetType: 'salon',
    targetId: salonId,
    details: { name: salon.name },
  });
  const { error: delError } = await supabase.from('salons').delete().eq('id', salonId);
  if (delError) throw delError;
  clearSessionCache();
}
