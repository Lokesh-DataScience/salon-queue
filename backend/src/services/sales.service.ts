// backend/src/services/sales.service.ts
// Sales tab: salon activity, churn risk, area breakdown, partner flag + notes.
// Salon and owner contact only — never customer data.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { logAdminAction } from './admin.service';
import type { Actor } from './founderSalons.service';

interface ActivityRow {
  id: string;
  name: string;
  phone: string;
  address: string;
  created_at: string;
  is_suspended: boolean;
  district: string | null;
  state: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  last_ticket_at: string | null;
  days_since_last_ticket: number | null;
  tickets_7d: number;
  tickets_month: number;
  churn_risk: boolean;
  is_partner: boolean;
  notes: string;
  info_updated_at: string | null;
}

export const UNKNOWN_AREA = 'Unknown area';

const areaOf = (r: Pick<ActivityRow, 'district' | 'state'>) =>
  r.district ? (r.state ? `${r.district}, ${r.state}` : r.district) : r.state ?? UNKNOWN_AREA;

export async function getSalesActivity() {
  const { data, error } = await supabase.rpc('sales_salon_activity');
  if (error) throw error;
  if (!data) throw new AppError('Could not load salon activity.', 500);

  const raw = data as { today: string; salons: ActivityRow[] };
  const salons = (raw.salons ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    address: r.address,
    area: areaOf(r),
    createdAt: r.created_at,
    isSuspended: r.is_suspended,
    owner: { name: r.owner_name, email: r.owner_email, phone: r.owner_phone },
    lastTicketAt: r.last_ticket_at,
    daysSinceLastTicket: r.days_since_last_ticket,
    tickets7d: r.tickets_7d,
    avgPerDay7d: Math.round((r.tickets_7d / 7) * 10) / 10,
    ticketsThisMonth: r.tickets_month,
    churnRisk: r.churn_risk,
    isPartner: r.is_partner,
    notes: r.notes,
    infoUpdatedAt: r.info_updated_at,
  }));

  // Churn risk first; within each group, the longest-quiet salon first; never-used salons before quiet ones.
  const quiet = (d: number | null) => (d === null ? Number.MAX_SAFE_INTEGER : d);
  salons.sort(
    (a, b) =>
      Number(b.churnRisk) - Number(a.churnRisk) ||
      quiet(b.daysSinceLastTicket) - quiet(a.daysSinceLastTicket) ||
      a.name.localeCompare(b.name),
  );

  const byArea = new Map<string, { area: string; salons: number; activeSalons7d: number; ticketsThisMonth: number }>();
  for (const s of salons) {
    const a = byArea.get(s.area) ?? { area: s.area, salons: 0, activeSalons7d: 0, ticketsThisMonth: 0 };
    a.salons += 1;
    if (s.tickets7d > 0) a.activeSalons7d += 1;
    a.ticketsThisMonth += s.ticketsThisMonth;
    byArea.set(s.area, a);
  }
  const areas = [...byArea.values()].sort((x, y) => y.salons - x.salons || x.area.localeCompare(y.area));

  return { today: raw.today, salons, areas };
}

export async function updateSalesInfo(actor: Actor, salonId: string, patch: { isPartner?: boolean; notes?: string }) {
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id, name')
    .eq('id', salonId)
    .maybeSingle();
  if (salonError) throw salonError;
  if (!salon) throw new AppError('Salon not found.', 404);

  const { data: current, error: curError } = await supabase
    .from('salon_sales_info')
    .select('is_partner, notes')
    .eq('salon_id', salonId)
    .maybeSingle();
  if (curError) throw curError;

  const next = {
    salon_id: salonId,
    is_partner: patch.isPartner ?? current?.is_partner ?? false,
    notes: patch.notes ?? current?.notes ?? '',
    updated_by: actor.staffId,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('salon_sales_info').upsert(next, { onConflict: 'salon_id' });
  if (error) throw error;

  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'sales.update_info',
    targetType: 'salon',
    targetId: salonId,
    details: {
      name: salon.name,
      ...(patch.isPartner !== undefined ? { isPartner: patch.isPartner } : {}),
      ...(patch.notes !== undefined ? { notesChanged: true } : {}),
    },
  });

  return { salonId, isPartner: next.is_partner, notes: next.notes };
}
