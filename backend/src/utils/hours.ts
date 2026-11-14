// backend/src/utils/hours.ts
const IST_OFFSET_MINUTES = 330; // India Standard Time, UTC+5:30

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// "now" shifted so its UTC fields read as India wall-clock time.
function istNow(now: Date): Date {
  return new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
}

// True when "now" in India is within [opening, closing], compared by the minute.
// Same rule as the SQL is_within_hours(): windows it can't interpret never block.
export function isWithinHours(opening: string, closing: string, now: Date = new Date()): boolean {
  const open = toMinutes(opening);
  const close = toMinutes(closing);
  if (open === null || close === null || open >= close) return true;
  const ist = istNow(now);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= open && minutes <= close;
}

// Today's weekday in India: 0 = Sunday, 1 = Monday ... 6 = Saturday
// (the same numbering as Postgres extract(dow) and salons.weekly_off_days).
export function istWeekday(now: Date = new Date()): number {
  return istNow(now).getUTCDay();
}

// True when today (India time) is one of the salon's weekly off days.
// Same rule as the SQL is_off_day(). No off days never blocks.
export function isOffDay(days: readonly number[] | null | undefined, now: Date = new Date()): boolean {
  return Array.isArray(days) && days.includes(istWeekday(now));
}