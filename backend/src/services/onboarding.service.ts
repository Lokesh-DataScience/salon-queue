// backend/src/services/onboarding.service.ts
// Sales tab → Onboarding: how far each new salon has got, and who is stuck where.
// Steps (in order): registered → added services → first ticket → first QR scan → still active.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { UNKNOWN_AREA } from './sales.service';

export type OnboardingPeriod = '30' | '90' | 'all';
export type StepId = 'services' | 'first_ticket' | 'first_qr' | 'active';

const DAY = 86_400_000;
export const ACTIVE_WINDOW_DAYS = 7;

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'services', label: 'Added services' },
  { id: 'first_ticket', label: 'First ticket (walk-in or QR)' },
  { id: 'first_qr', label: 'First customer QR scan' },
  { id: 'active', label: `Still active (ticket in the last ${ACTIVE_WINDOW_DAYS} days)` },
];

interface Row {
  id: string;
  name: string;
  phone: string;
  created_at: string;
  is_suspended: boolean;
  district: string | null;
  state: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  has_services: boolean;
  first_ticket_at: string | null;
  first_qr_at: string | null;
  last_ticket_at: string | null;
}

const areaOf = (r: Row) =>
  r.district ? (r.state ? `${r.district}, ${r.state}` : r.district) : r.state ?? UNKNOWN_AREA;

function median(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 10) / 10;
}

export async function getOnboarding(period: OnboardingPeriod, now = Date.now()) {
  const since = period === 'all' ? null : new Date(now - Number(period) * DAY).toISOString();
  const { data, error } = await supabase.rpc('sales_onboarding', { p_since: since });
  if (error) throw error;
  if (!Array.isArray(data)) throw new AppError('Could not load onboarding.', 500);

  const salons = (data as Row[]).map((r) => {
    const created = Date.parse(r.created_at);
    const eligibleForActive = now - created >= ACTIVE_WINDOW_DAYS * DAY;
    const reached: Record<StepId, boolean> = {
      services: r.has_services,
      first_ticket: !!r.first_ticket_at,
      first_qr: !!r.first_qr_at,
      active: eligibleForActive && !!r.last_ticket_at && now - Date.parse(r.last_ticket_at) <= ACTIVE_WINDOW_DAYS * DAY,
    };
    // The first step not done yet. "active" can't be missed by a salon that is too new to judge.
    const missing = STEPS.find((s) => !reached[s.id] && (s.id !== 'active' || eligibleForActive))?.id ?? null;
    return {
      id: r.id,
      name: r.name,
      area: areaOf(r),
      createdAt: r.created_at,
      isSuspended: r.is_suspended,
      owner: { name: r.owner_name, phone: r.owner_phone ?? r.phone, email: r.owner_email },
      reached,
      eligibleForActive,
      nextStep: missing,
      daysToFirstTicket: r.first_ticket_at ? (Date.parse(r.first_ticket_at) - created) / DAY : null,
    };
  });

  const registered = salons.length;
  const eligible = salons.filter((s) => s.eligibleForActive).length;
  const steps = STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    count: salons.filter((x) => x.reached[s.id]).length,
    // Percent of everyone registered; for "active", of those registered long enough to judge.
    outOf: s.id === 'active' ? eligible : registered,
  }));

  return {
    period,
    registered,
    steps,
    medianDaysToFirstTicket: median(salons.flatMap((s) => (s.daysToFirstTicket === null ? [] : [s.daysToFirstTicket]))),
    salons: salons.map(({ daysToFirstTicket: _d, ...s }) => s),
  };
}
