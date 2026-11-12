// backend/src/services/founder.service.ts
// Founder overview numbers. Counts only — no names, phones or per-customer rows.
// Rules live in the founder_overview() SQL function (same India-time rules as barber_stats).
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';

interface OverviewRow {
  today: string;
  week_start: string;
  month_start: string;
  salons: { total: number; new_this_month: number; active_7d: number };
  tickets: {
    today: number;
    today_walk_in: number;
    yesterday: number;
    week: number;
    week_walk_in: number;
    month: number;
    month_walk_in: number;
  };
  served: { today: number; week: number; month: number };
  days: { date: string; tickets: number; served: number }[];
}

const period = (tickets: number, walkIn: number, served: number) => ({
  tickets,
  walkIn,
  qr: tickets - walkIn,
  served,
});

export async function getFounderOverview() {
  const { data, error } = await supabase.rpc('founder_overview');
  if (error) throw error;
  if (!data) throw new AppError('Could not load the overview.', 500);

  const o = data as OverviewRow;
  return {
    today: o.today,
    weekStart: o.week_start,
    monthStart: o.month_start,
    salons: {
      total: o.salons.total,
      newThisMonth: o.salons.new_this_month,
      active7d: o.salons.active_7d,
    },
    periods: {
      today: { ...period(o.tickets.today, o.tickets.today_walk_in, o.served.today), ticketsYesterday: o.tickets.yesterday },
      week: period(o.tickets.week, o.tickets.week_walk_in, o.served.week),
      month: period(o.tickets.month, o.tickets.month_walk_in, o.served.month),
    },
    days: o.days ?? [],
  };
}
