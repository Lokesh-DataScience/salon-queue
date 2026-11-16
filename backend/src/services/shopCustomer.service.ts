// backend/src/services/shopCustomer.service.ts — customer session, checkout and orders (Commerce Phase 1, C4).
//
// Access (§9.1–9.2): a 256-bit random value in an HttpOnly cookie. Only its SHA-256 is stored. It is never
// sent to JavaScript, browser storage or a URL. A phone number, customer id or order number never grants
// access by itself: a device sees the orders it placed, plus (C4b/C5) those of a customer it is verified for.
// Logs carry ids and codes only — never names, phones or addresses.
import { createHash, randomBytes } from 'crypto';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { shopDbError } from './shopAdmin.service';
import { quoteFromRow, type QuoteRow } from './shopPublic.service';

export const SHOP_ACCESS_COOKIE = env.NODE_ENV === 'production' ? '__Host-svq_shop_access' : 'svq_shop_access'; // D26
export const SHOP_ACCESS_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.NODE_ENV === 'production',
  path: '/',
  maxAge: 400 * 24 * 60 * 60 * 1000, // the longest browsers keep a cookie
};

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ShopAccess {
  profileId: string;
  keyId: string;
}

// The device's access, or null (no cookie, unknown or revoked key).
export async function accessFromCookie(raw: unknown): Promise<ShopAccess | null> {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const { data, error } = await supabase
    .from('shop_access_keys')
    .select('id, profile_id, revoked_at')
    .eq('key_hash', sha256(raw))
    .maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at) return null;
  return { profileId: data.profile_id as string, keyId: data.id as string };
}

// POST /api/shop/session: reuse the device's key, or create a profile + key. Returns the raw value only when new.
export async function ensureSession(existing: ShopAccess | null): Promise<{ access: ShopAccess; newCookie: string | null }> {
  const now = new Date().toISOString();
  if (existing) {
    await Promise.all([
      supabase.from('shop_access_keys').update({ last_seen_at: now }).eq('id', existing.keyId),
      supabase.from('shop_access_profiles').update({ last_seen_at: now }).eq('id', existing.profileId),
    ]);
    return { access: existing, newCookie: null };
  }
  const raw = randomBytes(32).toString('base64url'); // 43 chars, 256 bits
  const { data: profile, error: e1 } = await supabase.from('shop_access_profiles').insert({}).select('id').single();
  if (e1) throw e1;
  const { data: key, error: e2 } = await supabase
    .from('shop_access_keys')
    .insert({ profile_id: profile.id, key_hash: sha256(raw) })
    .select('id')
    .single();
  if (e2) throw e2;
  return { access: { profileId: profile.id as string, keyId: key.id as string }, newCookie: raw };
}

// ── Checkout ─────────────────────────────────────────────────────────────

export interface CheckoutInput {
  items: { productId: string; qty: number }[];
  expectedTotalPaise: number;
  customer: { name: string; phone: string; addressLine1: string; addressLine2: string; landmark: string; pincode: string };
  consent: true;
  requestSameDay: boolean;
}

// The same request always hashes the same (item order doesn't matter); the expected total is left out on
// purpose: a PRICE_CHANGED answer writes nothing, so the retry with the new total may reuse the key.
export function requestHash(input: CheckoutInput): string {
  const items = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)).map((i) => [i.productId, i.qty]);
  const c = input.customer;
  return sha256(
    JSON.stringify({ items, customer: [c.name, c.phone, c.addressLine1, c.addressLine2, c.landmark, c.pincode], sameDay: input.requestSameDay }),
  );
}

export type CheckoutResult =
  | { kind: 'CREATED' | 'EXISTING'; orderId: string; orderNumber: string }
  | { kind: 'PRICE_CHANGED' | 'CART_PROBLEM'; quote: Awaited<ReturnType<typeof quoteFromRow>> }
  | { kind: 'TOO_MANY_OPEN_ORDERS'; max: number }
  | { kind: 'IDEMPOTENCY_MISMATCH' };

export async function placeOrder(access: ShopAccess, idempotencyKey: string, input: CheckoutInput): Promise<CheckoutResult> {
  const c = input.customer;
  const { data, error } = await supabase.rpc('place_order', {
    p_profile_id: access.profileId,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash(input),
    p_items: input.items.map((i) => ({ product_id: i.productId, qty: i.qty })),
    p_expected_total_paise: input.expectedTotalPaise,
    p_customer: {
      name: c.name,
      phone_e164: c.phone,
      address_line1: c.addressLine1,
      address_line2: c.addressLine2,
      landmark: c.landmark,
      pincode: c.pincode,
    },
    p_consent: input.consent,
    p_request_same_day: input.requestSameDay,
    p_source: {},
  });
  if (error) {
    if (error.message === 'IDEMPOTENCY_MISMATCH') return { kind: 'IDEMPOTENCY_MISMATCH' };
    if (error.message === 'SHOP_NO_CONSENT') throw new AppError('Please agree to saving your details for delivery.', 400);
    if (error.message === 'SHOP_INVALID_CART') throw new AppError('Your cart could not be read. Please try again.', 400);
    // reservation backstop (stock_reserved <= stock_on_hand) under an extreme race: just "out of stock"
    if (error.code === '23514' && String(error.message).includes('products_reserved_le_on_hand')) {
      throw new AppError('Some items just went out of stock. Please check your cart.', 409);
    }
    shopDbError(error);
  }
  const r = data as { result: string; order_id?: string; order_number?: string; quote?: QuoteRow; max?: number };
  switch (r.result) {
    case 'CREATED':
    case 'EXISTING':
      return { kind: r.result, orderId: r.order_id!, orderNumber: r.order_number! };
    case 'PRICE_CHANGED':
    case 'CART_PROBLEM':
      return { kind: r.result, quote: await quoteFromRow(r.quote!) };
    case 'TOO_MANY_OPEN_ORDERS':
      return { kind: 'TOO_MANY_OPEN_ORDERS', max: r.max ?? 2 };
    default:
      throw new Error(`place_order: unexpected result ${r.result}`);
  }
}

// ── Orders: only those this device may see ───────────────────────────────

const CANCELLABLE = ['PLACED', 'SUPPLIER_PENDING', 'SUPPLIER_CONFIRMED', 'COLLECTED'];

// Customer ids this profile is verified for (C4b device link / C5 founder callback).
async function linkedCustomerIds(profileId: string): Promise<string[]> {
  const { data, error } = await supabase.from('shop_profile_customers').select('customer_id').eq('profile_id', profileId);
  if (error) throw error;
  return (data ?? []).map((r) => r.customer_id as string);
}

function ownershipFilter(profileId: string, customers: string[]) {
  return customers.length
    ? `placed_by_profile_id.eq.${profileId},customer_id.in.(${customers.join(',')})`
    : `placed_by_profile_id.eq.${profileId}`;
}

export async function listMyOrders(access: ShopAccess | null) {
  if (!access) return [];
  const customers = await linkedCustomerIds(access.profileId);
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, status, total_paise, same_day_state, created_at, order_items (quantity)')
    .or(ownershipFilter(access.profileId, customers))
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((o) => ({
    id: o.id as string,
    orderNumber: o.order_number as string,
    status: o.status as string,
    totalPaise: o.total_paise as number,
    sameDayState: o.same_day_state as string,
    createdAt: o.created_at as string,
    itemCount: ((o.order_items as { quantity: number }[]) ?? []).reduce((n, i) => n + i.quantity, 0),
  }));
}

export async function getMyOrder(access: ShopAccess | null, orderId: string) {
  if (!access) throw new AppError('Order not found.', 404);
  const customers = await linkedCustomerIds(access.profileId);
  const { data: o, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, status, payment_method, payment_status, customer_name, customer_phone, address_line1, address_line2, landmark, pincode, ' +
        'subtotal_paise, delivery_fee_paise, total_paise, same_day_state, expected_delivery_date, expected_delivery_note, created_at, delivered_at, cancel_reason, cancelled_by, ' +
        'order_items (id, product_id, product_name, unit_price_paise, mrp_paise, quantity, line_total_paise), ' +
        'order_events (id, event_type, to_value, note, customer_visible, created_at)',
    )
    .eq('id', orderId)
    .or(ownershipFilter(access.profileId, customers))
    .maybeSingle();
  if (error) throw error;
  if (!o) throw new AppError('Order not found.', 404); // someone else's order looks exactly like a missing one
  const row = o as unknown as Record<string, unknown> & {
    order_items: { id: string; product_id: string | null; product_name: string; unit_price_paise: number; mrp_paise: number; quantity: number; line_total_paise: number }[];
    order_events: { id: number; event_type: string; to_value: string | null; note: string; customer_visible: boolean; created_at: string }[];
  };
  const { data: settings } = await supabase.from('shop_settings').select('founder_contact_phone').eq('id', true).maybeSingle();
  return {
    id: row.id as string,
    orderNumber: row.order_number as string,
    status: row.status as string,
    paymentMethod: row.payment_method as string,
    paymentStatus: row.payment_status as string,
    createdAt: row.created_at as string,
    deliveredAt: (row.delivered_at as string | null) ?? null,
    sameDayState: row.same_day_state as string,
    expectedDeliveryDate: (row.expected_delivery_date as string | null) ?? null,
    expectedDeliveryNote: row.expected_delivery_note as string,
    cancelReason: row.cancel_reason as string,
    cancelledBy: (row.cancelled_by as string | null) ?? null,
    canCancel: CANCELLABLE.includes(row.status as string),
    delivery: {
      name: row.customer_name as string,
      phone: row.customer_phone as string,
      addressLine1: row.address_line1 as string,
      addressLine2: row.address_line2 as string,
      landmark: row.landmark as string,
      pincode: row.pincode as string,
    },
    items: [...row.order_items]
      .sort((a, b) => a.product_name.localeCompare(b.product_name))
      .map((i) => ({
        productId: i.product_id,
        name: i.product_name,
        qty: i.quantity,
        unitPricePaise: i.unit_price_paise,
        mrpPaise: i.mrp_paise,
        lineTotalPaise: i.line_total_paise,
      })),
    subtotalPaise: row.subtotal_paise as number,
    deliveryFeePaise: row.delivery_fee_paise as number,
    totalPaise: row.total_paise as number,
    timeline: [...row.order_events]
      .filter((e) => e.customer_visible)
      .sort((a, b) => a.id - b.id)
      .map((e) => ({ type: e.event_type, to: e.to_value, note: e.note, at: e.created_at })),
    contactPhone: (settings?.founder_contact_phone as string) || null,
  };
}

export async function cancelMyOrder(access: ShopAccess, orderId: string, reason: string) {
  const { error } = await supabase.rpc('customer_cancel_order', { p_profile_id: access.profileId, p_order_id: orderId, p_reason: reason });
  if (error) {
    if (error.message === 'SHOP_NOT_FOUND') throw new AppError('Order not found.', 404);
    if (error.message === 'SHOP_CANNOT_CANCEL') {
      throw new AppError("This order can't be cancelled any more: it is already on its way or finished.", 409);
    }
    shopDbError(error);
  }
  return getMyOrder(access, orderId);
}

// §10.2 (unverified device): prefill from THIS device's own most recent order. Never from a typed phone number.
export async function prefillFor(access: ShopAccess | null) {
  if (!access) return null;
  const { data, error } = await supabase
    .from('orders')
    .select('customer_name, customer_phone, address_line1, address_line2, landmark, pincode')
    .eq('placed_by_profile_id', access.profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    source: 'last_order' as const,
    name: data.customer_name as string,
    phone: data.customer_phone as string,
    addressLine1: data.address_line1 as string,
    addressLine2: data.address_line2 as string,
    landmark: data.landmark as string,
    pincode: data.pincode as string,
  };
}
