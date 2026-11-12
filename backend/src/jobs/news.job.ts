// backend/src/jobs/news.job.ts
import { refreshAllStaleFeeds } from '../services/news.service';
import { errorCode, recordFailure, recordSuccess } from '../services/heartbeat.service';

const TICK_MS = 15 * 60 * 1000;

// Every tick refreshes only feeds not yet refreshed since today's refresh hour (India time),
// so it runs once a day and catches up if the free-tier server was asleep at that hour.
export function startNewsJob() {
  const tick = async () => {
    try {
      const r = await refreshAllStaleFeeds();
      if (r.refreshed > 0) console.log(`[news] refreshed ${r.refreshed} of ${r.checked} feeds`);
      await recordSuccess('news', { refreshed: r.refreshed, checked: r.checked });
    } catch (err) {
      console.error('[news] job failed');
      await recordFailure('news', errorCode(err));
    }
  };
  setTimeout(tick, 15_000).unref();
  setInterval(tick, TICK_MS).unref();
}
