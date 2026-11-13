// backend/src/services/ratings.service.ts
// Customer app polish, slice 5: 1–5 star ratings of a finished visit. Stars only.
import { supabase } from '../config/supabase';

export const MIN_PUBLIC_RATINGS = 5; // customers see the average only from this many ratings
export const RATING_WINDOW_DAYS = 7; // a visit can be rated (or re-rated) for this long after it finished

export interface RatingStats {
  count: number;
  average: number | null; // one decimal; null when there are no ratings
  byStars: Record<1 | 2 | 3 | 4 | 5, number>;
}

export async function getRatingStats(salonId: string): Promise<RatingStats> {
  const { data, error } = await supabase.rpc('salon_rating_stats', { p_salon_id: salonId });
  if (error) throw error;
  const byStars: RatingStats['byStars'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of (data ?? []) as Array<{ stars: number; n: number }>) {
    if (row.stars >= 1 && row.stars <= 5) byStars[row.stars as 1 | 2 | 3 | 4 | 5] = Number(row.n) || 0;
  }
  const count = Object.values(byStars).reduce((a, b) => a + b, 0);
  const sum = Object.entries(byStars).reduce((a, [s, n]) => a + Number(s) * n, 0);
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, byStars };
}

// What customers see on the salon page: nothing until there are enough ratings to be fair.
export function publicRating(stats: RatingStats): { average: number; count: number } | null {
  return stats.count >= MIN_PUBLIC_RATINGS && stats.average !== null
    ? { average: stats.average, count: stats.count }
    : null;
}

interface TicketRow {
  id: string;
  status: string;
  completed_at: string | null;
  queues: { salon_id: string } | null;
}

async function findTicket(ticketId: string, accessToken: string): Promise<TicketRow | null> {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('id, status, completed_at, queues(salon_id)')
    .eq('id', ticketId)
    .eq('access_token', accessToken)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as TicketRow) ?? null;
}

function canRate(t: TicketRow, now = Date.now()): boolean {
  if (t.status !== 'COMPLETED' || !t.completed_at) return false;
  return now - Date.parse(t.completed_at) <= RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// The ticket page asks: may I rate this visit, and did I already?
export async function getMyRating(ticketId: string, accessToken: string) {
  const t = await findTicket(ticketId, accessToken);
  if (!t) return null;
  const { data, error } = await supabase.from('ticket_ratings').select('stars').eq('ticket_id', t.id).maybeSingle();
  if (error) throw error;
  return { stars: (data?.stars as number | undefined) ?? null, canRate: canRate(t) };
}

export type RateResult = { ok: true; stars: number } | { ok: false; reason: 'NOT_FOUND' | 'NOT_COMPLETED' | 'TOO_LATE' };

export async function rateTicket(ticketId: string, accessToken: string, stars: number): Promise<RateResult> {
  const t = await findTicket(ticketId, accessToken);
  if (!t || !t.queues?.salon_id) return { ok: false, reason: 'NOT_FOUND' };
  if (t.status !== 'COMPLETED' || !t.completed_at) return { ok: false, reason: 'NOT_COMPLETED' };
  if (!canRate(t)) return { ok: false, reason: 'TOO_LATE' };

  // One row per ticket: rating again changes the stars instead of adding a second rating.
  const { error } = await supabase
    .from('ticket_ratings')
    .upsert({ ticket_id: t.id, salon_id: t.queues.salon_id, stars }, { onConflict: 'ticket_id' });
  if (error) throw error;
  return { ok: true, stars };
}
