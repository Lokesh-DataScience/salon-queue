// backend/src/services/offers.service.ts
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { todayISODate } from '../utils/date';

const MAX_OFFERS = 10;

export async function setExpectedCustomers(salonId: string, value: number | null) {
  const { data, error } = await supabase
    .from('salons')
    .update({ expected_daily_customers: value })
    .eq('id', salonId) // from the JWT, never the request
    .select('expected_daily_customers')
    .single();
  if (error) throw error;
  return { expectedCustomers: data.expected_daily_customers as number | null };
}

export async function listOffers(salonId: string) {
  const { data: offers, error } = await supabase
    .from('salon_offers')
    .select('id, name, daily_count, active, created_at')
    .eq('salon_id', salonId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;

  // Count only: how many prizes were redeemed today. Never who, never how many are left.
  const { data: redeemed, error: rErr } = await supabase
    .from('queue_entries')
    .select('offer_id, queues!inner(salon_id, date)')
    .not('prize_redeemed_at', 'is', null)
    .eq('queues.salon_id', salonId)
    .eq('queues.date', todayISODate());
  if (rErr) throw rErr;

  const counts = new Map<string, number>();
  for (const r of redeemed ?? []) {
    if (r.offer_id) counts.set(r.offer_id, (counts.get(r.offer_id) ?? 0) + 1);
  }
  const { data: salonRow, error: sErr } = await supabase
    .from('salons')
    .select('expected_daily_customers')
    .eq('id', salonId)
    .single();
  if (sErr) throw sErr;

  return {
    offers: (offers ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      dailyCount: o.daily_count,
      active: o.active,
      redeemedToday: counts.get(o.id) ?? 0,
    })),
    totalRedeemedToday: (redeemed ?? []).length,
    expectedCustomers: salonRow.expected_daily_customers as number | null,
  };
}

export async function createOffer(salonId: string, input: { name: string; dailyCount: number }) {
  const { count } = await supabase
    .from('salon_offers')
    .select('id', { count: 'exact', head: true })
    .eq('salon_id', salonId)
    .is('deleted_at', null);
  if ((count ?? 0) >= MAX_OFFERS) {
    throw new AppError(`You can have at most ${MAX_OFFERS} offers.`, 409);
  }

  const { data, error } = await supabase
    .from('salon_offers')
    .insert({ salon_id: salonId, name: input.name, daily_count: input.dailyCount })
    .select('id, name, daily_count, active')
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, dailyCount: data.daily_count, active: data.active };
}

export async function updateOffer(
  salonId: string,
  offerId: string,
  patch: { name?: string; dailyCount?: number; active?: boolean },
) {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.dailyCount !== undefined) update.daily_count = patch.dailyCount;
  if (patch.active !== undefined) update.active = patch.active;

  const { data, error } = await supabase
    .from('salon_offers')
    .update(update)
    .eq('id', offerId)
    .eq('salon_id', salonId) // ownership: the salon comes from the JWT, never the request
    .is('deleted_at', null)
    .select('id, name, daily_count, active')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Offer not found.', 404);
  return { id: data.id, name: data.name, dailyCount: data.daily_count, active: data.active };
}

// Soft delete: a customer who already won this offer today must still be able to redeem it.
export async function deleteOffer(salonId: string, offerId: string) {
  const { data, error } = await supabase
    .from('salon_offers')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', offerId)
    .eq('salon_id', salonId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Offer not found.', 404);
}

export async function redeemPrize(salonId: string, code: string) {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('id, status, prize_redeemed_at, salon_offers(name), queues!inner(salon_id, date)')
    .eq('prize_code', code)
    .eq('queues.salon_id', salonId)
    .eq('queues.date', todayISODate())
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Code not found for today.', 404);

  if (data.prize_redeemed_at) throw new AppError('This prize was already redeemed.', 409);
  if (!['SERVING', 'COMPLETED'].includes(data.status)) {
    throw new AppError('Redeem after the customer has been served.', 409);
  }

  const { data: updated, error: upErr } = await supabase
    .from('queue_entries')
    .update({ prize_redeemed_at: new Date().toISOString() })
    .eq('id', data.id)
    .is('prize_redeemed_at', null) // compare-and-swap: a double tap redeems once
    .in('status', ['SERVING', 'COMPLETED'])
    .select('id')
    .maybeSingle();
  if (upErr) throw upErr;
  if (!updated) throw new AppError('This prize was already redeemed.', 409);

  const offer = data.salon_offers as unknown as { name: string } | null;
  return { prizeName: offer?.name ?? 'Reward' };
}