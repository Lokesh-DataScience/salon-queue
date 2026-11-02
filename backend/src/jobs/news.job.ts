// backend/src/jobs/news.job.ts
import { refreshAllStaleFeeds } from '../services/news.service';

const TICK_MS = 15 * 60 * 1000;

// Every tick refreshes only feeds not yet refreshed since today's refresh hour (India time),
// so it runs once a day and catches up if the free-tier server was asleep at that hour.
export function startNewsJob() {
  const tick = async () => {
    try {
      const r = await refreshAllStaleFeeds();
      if (r.refreshed > 0) console.log(`[news] refreshed ${r.refreshed} of ${r.checked} feeds`);
    } catch {
      console.error('[news] job failed');
    }
  };
  setTimeout(tick, 15_000).unref();
  setInterval(tick, TICK_MS).unref();
}