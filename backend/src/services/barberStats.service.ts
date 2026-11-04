import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';

interface DayRow {
  date: string;
  count: number;
}

interface PeriodRow {
  start: string;
  total: number;
  walk_in: number;
  prev_same_period: number;
  days: DayRow[];
}

interface StatsRow {
  today: string;
  served_today: number;
  walk_in_today: number;
  served_yesterday: number;
  week: PeriodRow;
  month: PeriodRow;
}

function toPeriod(p: PeriodRow) {
  return {
    start: p.start,
    total: p.total,
    walkIn: p.walk_in,
    qr: p.total - p.walk_in,
    prevSamePeriod: p.prev_same_period,
    days: p.days,
  };
}

// Counts only: no names, phones or per-customer rows ever leave this function.
export async function getBarberStats(salonId: string) {
  const { data, error } = await supabase.rpc('barber_stats', { p_salon_id: salonId });
  if (error) throw error;
  if (!data) throw new AppError('Could not load stats.', 500);

  const s = data as StatsRow;
  return {
    today: s.today,
    servedToday: s.served_today,
    walkInToday: s.walk_in_today,
    qrToday: s.served_today - s.walk_in_today,
    servedYesterday: s.served_yesterday,
    week: toPeriod(s.week),
    month: toPeriod(s.month),
  };
}