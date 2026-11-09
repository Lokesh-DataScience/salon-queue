// backend/src/services/customers.service.ts
// The salon's own customer list. Always scoped by the salonId from the verified session, never from the request.
import { supabase } from '../config/supabase';

export interface SalonCustomerRow {
  id: string;
  name: string;
  phone: string;
  firstVisitAt: string;
  lastVisitAt: string;
  visitCount: number;
}

// Search text goes into a PostgREST filter, so keep only plain characters (no commas, brackets, % or quotes).
function cleanSearch(input?: string): string {
  return (input ?? '').replace(/[^\p{L}\p{N} .'+-]/gu, '').trim().slice(0, 40);
}

export async function listCustomers(salonId: string, search?: string): Promise<SalonCustomerRow[]> {
  let q = supabase
    .from('salon_customers')
    .select('id, name, phone, first_visit_at, last_visit_at, visit_count')
    .eq('salon_id', salonId)
    .order('last_visit_at', { ascending: false })
    .limit(500);

  const s = cleanSearch(search);
  if (s) q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    firstVisitAt: c.first_visit_at,
    lastVisitAt: c.last_visit_at,
    visitCount: c.visit_count,
  }));
}

export async function deleteCustomer(salonId: string, customerId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_salon_customer', {
    p_salon_id: salonId,
    p_customer_id: customerId,
  });
  if (error) throw error;
  return data === true;
}