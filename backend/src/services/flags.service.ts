// backend/src/services/flags.service.ts
// Feature flags: switched in Tech → Tools & flags, read by the app. Cached for 30 seconds;
// a change from the Tech tab clears the cache so it shows on the next read.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { logAdminAction } from './admin.service';
import type { Actor } from './founderSalons.service';

export interface Flag {
  key: string;
  enabled: boolean;
  value: string;
  description: string;
  updatedAt: string;
}

let cache: { at: number; flags: Flag[] } | null = null;
const TTL_MS = 30_000;

export async function listFlags(fresh = false): Promise<Flag[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.flags;
  const { data, error } = await supabase
    .from('feature_flags')
    .select('key, enabled, value, description, updated_at')
    .order('key');
  if (error) throw error;
  const flags = (data ?? []).map((r) => ({
    key: r.key as string,
    enabled: !!r.enabled,
    value: (r.value as string) ?? '',
    description: (r.description as string) ?? '',
    updatedAt: r.updated_at as string,
  }));
  cache = { at: Date.now(), flags };
  return flags;
}

// What the barber app needs: { key: { enabled, value } }. Descriptions stay internal.
export async function flagsForApp() {
  const flags = await listFlags();
  return Object.fromEntries(flags.map((f) => [f.key, { enabled: f.enabled, value: f.value }]));
}

export async function updateFlag(actor: Actor, key: string, patch: { enabled?: boolean; value?: string }) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.staffId };
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.value !== undefined) row.value = patch.value;
  const { data, error } = await supabase.from('feature_flags').update(row).eq('key', key).select('key').maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('No such flag. New flags are added with SQL.', 404);
  cache = null;
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'tech.flag_update',
    targetType: 'flag',
    targetId: key,
    details: { name: key, ...patch },
  });
}

export function clearFlagCache() {
  cache = null;
}
