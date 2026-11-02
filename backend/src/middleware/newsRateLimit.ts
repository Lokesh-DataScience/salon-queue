// backend/src/middleware/newsRateLimit.ts
import rateLimit from 'express-rate-limit';

const tooMany = { message: 'Too many requests. Please try again in a little while.' };

export function createNewsLimiters() {
  return {
    feed: rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: tooMany }),
    // public (registration happens before an account exists) and it calls an outside service, so keep it tight
    geo: rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: tooMany }),
  };
}