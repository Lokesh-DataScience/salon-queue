// backend/src/services/sessionState.service.ts
// Per-request check that a signed-in staff account may still be used:
//   - the staff row still exists
//   - their salon is not suspended
//   - the login token is newer than sessions_valid_after (set by the founder's password reset)
// Cached for a short time so a barber's dashboard doesn't add a database call to every tap.
// The founder's actions clear the cache, so they take effect on the very next request.
import { supabase } from '../config/supabase';
import { env } from '../config/env';

export interface SessionState {
  salonSuspended: boolean;
  sessionsValidAfterMs: number | null;
}

const TTL_MS = env.NODE_ENV === 'test' ? 0 : 30_000;
const cache = new Map<string, { state: SessionState | null; at: number }>();

export async function getSessionState(staffId: string): Promise<SessionState | null> {
  const hit = cache.get(staffId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.state;

  const { data, error } = await supabase
    .from('salon_staff')
    .select('id, sessions_valid_after, salons(is_suspended)')
    .eq('id', staffId)
    .maybeSingle();
  if (error) throw error; // infrastructure problem: 500, never a forced logout

  const salon = (Array.isArray(data?.salons) ? data?.salons[0] : data?.salons) as { is_suspended?: boolean } | null;
  const state: SessionState | null = data
    ? {
        salonSuspended: !!salon?.is_suspended,
        sessionsValidAfterMs: data.sessions_valid_after ? Date.parse(data.sessions_valid_after as string) : null,
      }
    : null;

  if (TTL_MS > 0) cache.set(staffId, { state, at: Date.now() });
  return state;
}

// A token issued before the cut-off is refused. iat is in whole seconds.
export function tokenIssuedBeforeCutoff(iatSeconds: number | undefined, cutoffMs: number | null): boolean {
  if (cutoffMs == null) return false;
  if (typeof iatSeconds !== 'number') return true;
  return iatSeconds * 1000 < cutoffMs;
}

export function clearSessionCache() {
  cache.clear();
}
