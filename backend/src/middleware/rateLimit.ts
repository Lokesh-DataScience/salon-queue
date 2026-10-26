import rateLimit from 'express-rate-limit';

function limiter(opts: {
  windowMs: number;
  limit: number;
  message: string;
  skipSuccessfulRequests?: boolean;
}) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: opts.skipSuccessfulRequests ?? false,
    message: { message: opts.message }, // same {message} shape the frontend already reads
  });
}

// Built per createApp() call so every app instance (and every test) gets fresh counters.
export function createRateLimiters() {
  return {
    global: limiter({
      windowMs: 60_000,
      limit: 300,
      message: 'Too many requests. Please slow down and try again shortly.',
    }),
    join: limiter({
      windowMs: 15 * 60_000,
      limit: 20,
      message: 'Too many queue joins from this network. Please try again in a few minutes.',
    }),
    // Only failed attempts (status >= 400) count, so a barber who logs in correctly is never locked out.
    login: limiter({
      windowMs: 15 * 60_000,
      limit: 10,
      skipSuccessfulRequests: true,
      message: 'Too many login attempts. Please try again in 15 minutes.',
    }),
    nearby: limiter({
      windowMs: 60_000,
      limit: 60,
      message: 'Too many searches. Please wait a moment and try again.',
    }),
    ticket: limiter({
      windowMs: 60_000,
      limit: 120,
      message: 'Too many requests. Please wait a moment and try again.',
    }),
        // Counts every attempt, successful or not: nobody legitimately registers more than a few salons an hour.
    register: limiter({
      windowMs: 60 * 60_000,
      limit: 5,
      message: 'Too many sign-up attempts from this network. Please try again later.',
    }),
  };
}