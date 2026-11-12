// backend/src/services/bugReports.service.ts
// Barbers report problems; the Tech tab reads them and sets a status the barber can see.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { logAdminAction } from './admin.service';
import type { Actor } from './founderSalons.service';
import type { BUG_STATUSES } from '../validators/admin.validators';

type BugStatus = (typeof BUG_STATUSES)[number];
const MAX_PER_HOUR = 5;

// Never keep query strings: ticket links carry access tokens.
const cleanPage = (p?: string) => (p ? p.split('?')[0].split('#')[0].slice(0, 200) : null);

export async function createBugReport(
  staff: { staffId: string; salonId: string },
  input: { kind: 'bug' | 'idea' | 'question'; message: string; page?: string; device?: string },
) {
  const { count, error: cErr } = await supabase
    .from('bug_reports')
    .select('*', { count: 'exact', head: true })
    .eq('staff_id', staff.staffId)
    .gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if (cErr) throw cErr;
  if ((count ?? 0) >= MAX_PER_HOUR) {
    throw new AppError("You've sent several reports in the last hour. Please wait a little before sending another.", 429);
  }

  const { data, error } = await supabase
    .from('bug_reports')
    .insert({
      staff_id: staff.staffId,
      salon_id: staff.salonId,
      kind: input.kind,
      message: input.message,
      page: cleanPage(input.page),
      device: input.device ?? null,
    })
    .select('id, created_at, kind, message, status, tech_note')
    .single();
  if (error) throw error;
  return toBarberView(data);
}

function toBarberView(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    kind: r.kind as string,
    message: r.message as string,
    status: r.status as BugStatus,
    techNote: (r.tech_note as string) ?? '',
  };
}

// A barber sees only their own reports.
export async function listMyBugReports(staffId: string) {
  const { data, error } = await supabase
    .from('bug_reports')
    .select('id, created_at, kind, message, status, tech_note')
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map(toBarberView);
}

const one = <T>(v: unknown): T | null => ((Array.isArray(v) ? v[0] : v) ?? null) as T | null;

export async function listBugReports(status: 'open' | 'all') {
  let q = supabase
    .from('bug_reports')
    .select(
      'id, created_at, kind, message, page, device, status, tech_note, updated_at, salon_id, ' +
        'salons(name), reporter:salon_staff!bug_reports_staff_id_fkey(name, email, phone)',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (status === 'open') q = q.in('status', ['new', 'investigating']);
  const { data, error } = await q;
  if (error) throw error;

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
    const salon = one<{ name: string }>(r.salons);
    const who = one<{ name: string; email: string | null; phone: string | null }>(r.reporter);
    return {
      id: r.id as string,
      createdAt: r.created_at as string,
      kind: r.kind as string,
      message: r.message as string,
      page: (r.page as string | null) ?? null,
      device: (r.device as string | null) ?? null,
      status: r.status as BugStatus,
      techNote: (r.tech_note as string) ?? '',
      updatedAt: r.updated_at as string,
      salonId: (r.salon_id as string | null) ?? null,
      salonName: salon?.name ?? null,
      reporter: who ? { name: who.name, contact: who.email ?? who.phone } : null,
    };
  });
}

export async function updateBugReport(actor: Actor, bugId: string, patch: { status?: BugStatus; techNote?: string }) {
  const { data: before, error: bErr } = await supabase.from('bug_reports').select('id, status').eq('id', bugId).maybeSingle();
  if (bErr) throw bErr;
  if (!before) throw new AppError('Report not found.', 404);

  const row: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.staffId };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.techNote !== undefined) row.tech_note = patch.techNote;
  const { error } = await supabase.from('bug_reports').update(row).eq('id', bugId);
  if (error) throw error;

  if (patch.status !== undefined && patch.status !== before.status) {
    await logAdminAction({
      actorStaffId: actor.staffId,
      actorRole: actor.role,
      action: 'tech.bug_status',
      targetType: 'bug_report',
      targetId: bugId,
      details: { status: patch.status, previousStatus: before.status },
    });
  }
  return { id: bugId, ...patch };
}
