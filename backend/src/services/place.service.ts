import { supabase } from '../config/supabase';

export interface PlaceInput {
  district?: string | null;
  state?: string | null;
}

const clean = (s?: string | null) => (s ?? '').normalize('NFC').replace(/[\s/]+/g, ' ').trim();
export const slug = (s?: string | null) => clean(s).toLowerCase();

// A place is a district inside a state. "Korba", " korba " and "KORBA" are the same place.
export function normalizePlace(input: PlaceInput) {
  const district = clean(input.district) || null;
  const state = clean(input.state) || null;
  const key = [slug(state) || '-', slug(district) || '-'].join('/');
  return { key, district, state };
}

export async function assignPlaceToSalon(salonId: string, input: PlaceInput): Promise<string> {
  const p = normalizePlace(input);
  if (!p.district && !p.state) throw new Error('district or state is required');
  const { data, error } = await supabase.rpc('assign_salon_place', {
    p_salon_id: salonId,
    p_key: p.key,
    p_district: p.district,
    p_state: p.state,
  });
  if (error) throw error;
  return data as string;
}