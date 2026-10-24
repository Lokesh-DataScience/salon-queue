// backend/src/utils/hours.ts
const IST_OFFSET_MINUTES = 330; // India Standard Time, UTC+5:30

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// True when "now" in India is within [opening, closing], compared by the minute.
// Same rule as the SQL is_within_hours(): windows it can't interpret never block.
export function isWithinHours(opening: string, closing: string, now: Date = new Date()): boolean {
  const open = toMinutes(opening);
  const close = toMinutes(closing);
  if (open === null || close === null || open >= close) return true;
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= open && minutes <= close;
}