// backend/src/utils/refreshWindow.ts
const IST_OFFSET_MS = 330 * 60 * 1000;

// The most recent "daily refresh time" (hourIST:00 India time) at or before `now`.
export function latestRefreshBoundary(now: Date, hourIST: number): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  let boundary =
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hourIST, 0, 0) - IST_OFFSET_MS;
  if (boundary > now.getTime()) boundary -= 24 * 60 * 60 * 1000;
  return new Date(boundary);
}

// A feed is stale if it has not been attempted since the latest daily refresh time.
// This also catches up automatically if the server was asleep at the scheduled hour.
export function isStale(lastAttempt: Date | null, now: Date, hourIST: number): boolean {
  if (!lastAttempt) return true;
  return lastAttempt.getTime() < latestRefreshBoundary(now, hourIST).getTime();
}