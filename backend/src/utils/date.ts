// backend/src/utils/date.ts
export function todayISODate() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" (UTC, matches CURRENT_DATE in the RPCs)
}