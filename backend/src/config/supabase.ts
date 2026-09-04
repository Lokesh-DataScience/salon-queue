// backend/src/config/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Server-side only. Uses the service role key, which bypasses Row Level
// Security — this client must never be exposed to the frontend or any
// untrusted context. See supabase/schema.sql for the RLS setup that makes
// this the only way in.
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});