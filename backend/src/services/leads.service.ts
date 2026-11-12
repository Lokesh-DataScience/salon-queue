// backend/src/services/leads.service.ts
// Sales leads: salons being talked to before they register. Shop/owner contact only.
// Every change is audit-logged under the "sales" group.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { normalizePhone } from '../utils/phone';
import { logAdminAction } from './admin.service';
import type { Actor } from './founderSalons.service';
import type { LEAD_STATUSES } from '../validators/admin.validators';

type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadInput {
  name?: string;
  ownerName?: string;
  phone?: string;
  area?: string;
  address?: string;
  status?: LeadStatus;
  followUpOn?: string | null;
  notes?: string;
  salonId?: string | null;
}

interface LeadRow {
  id: string;
  name: string;
  owner_name: string;
  phone: string;
  area: string;
  address: string;
  status: LeadStatus;
  follow_up_on: string | null;
  notes: string;
  salon_id: string | null;
  created_at: string;
  updated_at: string;
  salons: unknown;
}

const COLUMNS =
  'id, name, owner_name, phone, area, address, status, follow_up_on, notes, salon_id, created_at, updated_at, salons(name)';

export const todayInIndia = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now); // YYYY-MM-DD

function toLead(r: LeadRow) {
  const salon = (Array.isArray(r.salons) ? r.salons[0] : r.salons) as { name?: string } | null;
  return {
    id: r.id,
    name: r.name,
    ownerName: r.owner_name,
    phone: r.phone,
    area: r.area,
    address: r.address,
    status: r.status,
    followUpOn: r.follow_up_on,
    notes: r.notes,
    salonId: r.salon_id,
    salonName: salon?.name ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function cleanPhone(raw: string | undefined) {
  if (raw === undefined) return undefined;
  if (raw.trim() === '') return '';
  const p = normalizePhone(raw);
  if (!p) throw new AppError('Enter a valid 10-digit mobile number, or leave it empty.', 400);
  return p;
}

async function assertSalonExists(salonId: string | null | undefined) {
  if (!salonId) return;
  const { data, error } = await supabase.from('salons').select('id').eq('id', salonId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('That salon was not found.', 404);
}

async function assertPhoneFree(phone: string | undefined, exceptId?: string) {
  if (!phone) return;
  let q = supabase.from('sales_leads').select('id, name').eq('phone', phone).limit(1);
  if (exceptId) q = q.neq('id', exceptId);
  const { data, error } = await q;
  if (error) throw error;
  if (data && data.length) throw new AppError(`There is already a lead with this phone: ${data[0].name}.`, 409);
}

function toRow(input: LeadInput, phone: string | undefined) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.ownerName !== undefined) row.owner_name = input.ownerName;
  if (phone !== undefined) row.phone = phone;
  if (input.area !== undefined) row.area = input.area;
  if (input.address !== undefined) row.address = input.address;
  if (input.status !== undefined) row.status = input.status;
  if (input.followUpOn !== undefined) row.follow_up_on = input.followUpOn;
  if (input.notes !== undefined) row.notes = input.notes;
  if (input.salonId !== undefined) row.salon_id = input.salonId;
  // Linking a registered salon means the lead signed up.
  if (input.salonId && input.status === undefined) row.status = 'converted';
  return row;
}

export async function listLeads() {
  const { data, error } = await supabase
    .from('sales_leads')
    .select(COLUMNS)
    .order('follow_up_on', { ascending: true, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return { today: todayInIndia(), leads: ((data ?? []) as unknown as LeadRow[]).map(toLead) };
}

export async function createLead(actor: Actor, input: LeadInput & { name: string }) {
  const phone = cleanPhone(input.phone);
  await assertPhoneFree(phone);
  await assertSalonExists(input.salonId);

  const { data, error } = await supabase
    .from('sales_leads')
    .insert({ ...toRow(input, phone), created_by: actor.staffId, updated_by: actor.staffId })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const lead = toLead(data as unknown as LeadRow);

  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'sales.lead_create',
    targetType: 'lead',
    targetId: lead.id,
    details: { name: lead.name, status: lead.status },
  });
  return lead;
}

export async function updateLead(actor: Actor, leadId: string, input: LeadInput) {
  const { data: before, error: bErr } = await supabase.from('sales_leads').select('id, name, status').eq('id', leadId).maybeSingle();
  if (bErr) throw bErr;
  if (!before) throw new AppError('Lead not found.', 404);

  const phone = cleanPhone(input.phone);
  await assertPhoneFree(phone, leadId);
  await assertSalonExists(input.salonId);

  const { data, error } = await supabase
    .from('sales_leads')
    .update({ ...toRow(input, phone), updated_by: actor.staffId, updated_at: new Date().toISOString() })
    .eq('id', leadId)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const lead = toLead(data as unknown as LeadRow);

  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'sales.lead_update',
    targetType: 'lead',
    targetId: leadId,
    details: {
      name: lead.name,
      ...(lead.status !== before.status ? { status: lead.status, previousStatus: before.status } : {}),
      ...(input.salonId !== undefined ? { linkedSalon: lead.salonName } : {}),
    },
  });
  return lead;
}

export async function deleteLead(actor: Actor, leadId: string) {
  const { data, error } = await supabase.from('sales_leads').delete().eq('id', leadId).select('id, name').maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Lead not found.', 404);
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'sales.lead_delete',
    targetType: 'lead',
    targetId: leadId,
    details: { name: data.name },
  });
}
