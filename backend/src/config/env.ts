// backend/src/config/env.ts
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  // Backend-only, trusted, bypasses Row Level Security. Never send this to
  // the frontend or log it.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  NOTIFICATION_PROVIDER: z.string().default('console'),
  RETENTION_HOURS: z.coerce.number().int().min(0).default(24),
  CLEANUP_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(60),
  // "Getting close" at <= CLOSE_AT people ahead, "you're next" at <= NEXT_AT. Keep NEXT_AT < CLOSE_AT.
  NOTIFY_CLOSE_AT: z.coerce.number().int().min(1).default(2),
  NOTIFY_NEXT_AT: z.coerce.number().int().min(0).default(1),
    // Number of reverse-proxy hops in front of the app (Render/Railway/Fly = 1). 0 for local dev.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(10).default(900),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
    // true on the host: this server also serves the built frontend (one address, one origin)
  SERVE_FRONTEND: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}
if (
  parsed.data.NOTIFICATION_PROVIDER === 'webpush' &&
  (!parsed.data.VAPID_PUBLIC_KEY || !parsed.data.VAPID_PRIVATE_KEY)
) {
  console.error('NOTIFICATION_PROVIDER=webpush requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
  process.exit(1);
}
if (parsed.data.NODE_ENV === 'production') {
  const problems: string[] = [];
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const v = parsed.data[key];
    if (v.length < 32 || v.startsWith('change-me')) {
      problems.push(`${key} must be at least 32 random characters (not a dev placeholder).`);
    }
  }
  if (parsed.data.JWT_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must be different.');
  }
  if (parsed.data.FRONTEND_URL.includes('localhost')) {
    problems.push('FRONTEND_URL must be your real https frontend origin.');
  }
  if (parsed.data.TRUST_PROXY === 0) {
    console.warn('[config] TRUST_PROXY=0 in production: all clients will share one rate-limit bucket behind a proxy.');
  }
  if (parsed.data.NOTIFICATION_PROVIDER === 'console') {
    console.warn('[config] NOTIFICATION_PROVIDER=console in production: customers will NOT receive notifications.');
  }
  if (problems.length) {
    console.error('Unsafe production configuration:');
    problems.forEach((p) => console.error(` - ${p}`));
    process.exit(1);
  }
}

export const env = parsed.data;