// backend/src/services/shopOrdersAdmin.service.ts — Commerce C5a: the founder's order screens (§7, §11, §12).
// Reads: FOUNDER + COFOUNDER (D7: the cofounder sees everything, including costs and profit, but changes nothing).
// Writes: FOUNDER only — the route guard checks, and every database function checks again.
// Customer details are shown on these admin screens only. They never go into logs, pushes, audit details or the
// supplier WhatsApp text (Q14). The audit log keeps the order id and the move, nothing personal.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { logAdminAction } from './admin.service';
import type { Actor } from './founderSalons.service';
import { shopDbError } from './shopAdmin.service';

const OPEN = ['PLACED', 'SUPPLIER_PENDING', 'SUPPLIER_CONFIRMED', 'COLLECTED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'];

// Order-specific wording; anything else falls through to the shared shop messages.
const ORDER_MESSAGES: Record<string, [number, string]> = {
  SHOP_STALE: [409, 'This order changed since you opened it (maybe on another device). Refresh and check again.'],
  SHOP_BAD_TRANSITION: [409, "That step isn't possible from the order's current status. Refresh and check again."],
  SHOP_COSTS_REQUIRED: [400, "Enter the supplier's confirmed rate for every item."],
  SHOP_MISMATCH_NOTE_REQUIRED: [400, "The amount is different from the order total — write a short note about why."],
  SHOP_REASON_REQUIRED: [400, 'Please write a reason (at least 3 characters). The customer will see it.'],
};

async function orderRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const msg = error.message ?? '';
    const code = Object.keys(ORDER_MESSAGES).find((c) => msg === c || msg.startsWith(`${c}:`));
    if (code) throw new AppError(ORDER_MESSAGES[code][1], ORDER_MESSAGES[code][0]);
    shopDbError(error);
  }
  return data as T;
}

// ── Reads ────────────────────────────────────────────────────────────────

const LIST_COLUMNS =
  'id, order_number, status, payment_status, total_paise, same_day_state, expected_delivery_date, customer_name, ' +
  'pincode, created_at, updated_at, placed_reminder_count, order_items (quantity)';

interface ListRow {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total_paise: number;
  same_day_state: string;
  expected_delivery_date: string | null;
  customer_name: string;
  pincode: string;
  created_at: string;
  updated_at: string;
  placed_reminder_count: number;
  order_items: { quantity: number }[];
}

export async function listOrders(q: { status: string; search?: string; limit: number }) {
  let query = supabase.from('orders').select(LIST_COLUMNS).order('created_at', { ascending: false }).limit(q.limit);
  if (q.status === 'open') query = query.in('status', OPEN);
  else if (q.status !== 'all') query = query.eq('status', q.status);
  const digits = (q.search ?? '').replace(/\D/g, '');
  if (digits) query = query.eq('order_number', `SQ-${digits}`);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as ListRow[];
  const counts = await statusCounts();
  return {
    counts,
    orders: rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      paymentStatus: r.payment_status,
      totalPaise: r.total_paise,
      itemCount: r.order_items.reduce((n, i) => n + i.quantity, 0),
      sameDayState: r.same_day_state,
      expectedDeliveryDate: r.expected_delivery_date,
      customerName: r.customer_name,
      pincode: r.pincode,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      remindersSent: r.placed_reminder_count,
    })),
  };
}

async function statusCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('orders').select('status').in('status', OPEN);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const r of data ?? []) counts[r.status as string] = (counts[r.status as string] ?? 0) + 1;
  return counts;
}

export async function getOrder(orderId: string) {
  const [{ data: o, error: e1 }, { data: items, error: e2 }, { data: events, error: e3 }] = await Promise.all([
    supabase.from('orders').select('*, suppliers (name, phone)').eq('id', orderId).maybeSingle(),
    supabase
      .from('order_items')
      .select('id, product_id, product_name, sku, mrp_paise, unit_price_paise, quantity, line_total_paise, expected_unit_cost_paise, confirmed_unit_cost_paise, stock_state')
      .eq('order_id', orderId)
      .order('product_name'),
    supabase
      .from('order_events')
      .select('id, event_type, from_value, to_value, customer_visible, note, actor_type, created_at')
      .eq('order_id', orderId)
      .order('created_at')
      .order('id'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (!o) throw new AppError('Order not found. Refresh the list.', 404);

  const lines = (items ?? []).map((i) => {
    const cost = (i.confirmed_unit_cost_paise ?? i.expected_unit_cost_paise) as number;
    return {
      id: i.id as string,
      productId: i.product_id as string | null,
      productName: i.product_name as string,
      sku: i.sku as string,
      mrpPaise: i.mrp_paise as number,
      unitPricePaise: i.unit_price_paise as number,
      quantity: i.quantity as number,
      lineTotalPaise: i.line_total_paise as number,
      expectedUnitCostPaise: i.expected_unit_cost_paise as number,
      confirmedUnitCostPaise: i.confirmed_unit_cost_paise as number | null,
      stockState: i.stock_state as string,
      lineProfitPaise: (i.line_total_paise as number) - cost * (i.quantity as number),
    };
  });
  const costPaise = lines.reduce((n, l) => n + (l.confirmedUnitCostPaise ?? l.expectedUnitCostPaise) * l.quantity, 0);
  const allConfirmed = lines.every((l) => l.confirmedUnitCostPaise !== null);
  const supplier = o.suppliers as { name: string; phone: string } | null;

  return {
    order: {
      id: o.id as string,
      orderNumber: o.order_number as string,
      status: o.status as string,
      paymentMethod: o.payment_method as string,
      paymentStatus: o.payment_status as string,
      createdAt: o.created_at as string,
      updatedAt: o.updated_at as string,
      deliveredAt: o.delivered_at as string | null,
      customer: {
        name: o.customer_name as string,
        phone: o.customer_phone as string,
        addressLine1: o.address_line1 as string,
        addressLine2: o.address_line2 as string,
        landmark: o.landmark as string,
        pincode: o.pincode as string,
      },
      subtotalPaise: o.subtotal_paise as number,
      deliveryFeePaise: o.delivery_fee_paise as number,
      totalPaise: o.total_paise as number,
      sameDayState: o.same_day_state as string,
      expectedDeliveryDate: o.expected_delivery_date as string | null,
      expectedDeliveryNote: o.expected_delivery_note as string,
      cod: {
        collectedPaise: o.cod_collected_paise as number | null,
        collectedAt: o.cod_collected_at as string | null,
        mismatchNote: o.cod_mismatch_note as string,
      },
      supplier: supplier ? { name: supplier.name, phone: supplier.phone } : null,
      supplierContactedAt: o.supplier_contacted_at as string | null,
      fromSalon: Boolean(o.source_salon_id),
      cancelReason: o.cancel_reason as string | null,
      cancelledBy: o.cancelled_by as string | null,
      remindersSent: o.placed_reminder_count as number,
    },
    items: lines,
    // Expected until the supplier confirms rates (T3), then confirmed.
    finance: { costPaise, grossProfitPaise: (o.total_paise as number) - costPaise, costsConfirmed: allConfirmed },
    events: (events ?? []).map((e) => ({
      id: e.id as string,
      type: e.event_type as string,
      from: e.from_value as string | null,
      to: e.to_value as string | null,
      customerVisible: e.customer_visible as boolean,
      note: e.note as string,
      actorType: e.actor_type as string,
      at: e.created_at as string,
    })),
  };
}

// The text the founder sends the supplier on WhatsApp (Q14): products and quantities only. Never the customer's
// name, phone or address, and never our selling price.
export function supplierMessage(o: { orderNumber: string; sameDayState: string }, lines: { productName: string; sku: string; quantity: number }[]) {
  const when =
    o.sameDayState === 'REQUESTED' || o.sameDayState === 'CONFIRMED'
      ? 'Needed today if possible (आज चाहिए अगर हो सके).'
      : 'Needed in the next 1–2 days.';
  return [
    `Namaste! Order ${o.orderNumber}:`,
    ...lines.map((l, i) => `${i + 1}. ${l.productName}${l.sku ? ` (${l.sku})` : ''} × ${l.quantity}`),
    '',
    when,
    'Please confirm stock and your rate for each item. Thank you!',
  ].join('\n');
}

export async function getSupplierText(orderId: string) {
  const { order, items } = await getOrder(orderId);
  const text = supplierMessage(order, items);
  const digits = (order.supplier?.phone ?? '').replace(/\D/g, '');
  const waPhone = digits.length === 10 ? `91${digits}` : digits;
  return {
    text,
    supplierName: order.supplier?.name ?? null,
    whatsappUrl: waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}` : null,
  };
}

// ── Writes ───────────────────────────────────────────────────────────────

export async function transitionOrder(
  actor: Actor,
  orderId: string,
  input: {
    expectedFrom: string;
    to: string;
    note: string;
    lines?: { itemId: string; confirmedUnitCostPaise: number }[];
    delivery?: { date?: string | null; note?: string; sameDay?: 'CONFIRMED' | 'NOT_POSSIBLE' };
    markOutOfStock: boolean;
  },
) {
  await orderRpc('shop_transition_order', {
    p_actor: actor.staffId,
    p_order_id: orderId,
    p_expected_from: input.expectedFrom,
    p_to: input.to,
    p_note: input.note,
    p_lines: input.lines ? input.lines.map((l) => ({ item_id: l.itemId, confirmed_unit_cost_paise: l.confirmedUnitCostPaise })) : null,
    p_delivery: input.delivery
      ? { date: input.delivery.date ?? '', note: input.delivery.note ?? '', same_day: input.delivery.sameDay ?? null }
      : null,
    p_mark_out_of_stock: input.markOutOfStock,
  });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.order_status',
    targetType: 'order',
    targetId: orderId,
    details: { from: input.expectedFrom, to: input.to, ...(input.markOutOfStock ? { markOutOfStock: true } : {}) },
  });
  return getOrder(orderId);
}

export async function setDeliveryExpectation(
  actor: Actor,
  orderId: string,
  input: { date: string | null; note: string; sameDay: 'CONFIRMED' | 'NOT_POSSIBLE' | null },
) {
  await orderRpc('set_delivery_expectation', {
    p_actor: actor.staffId,
    p_order_id: orderId,
    p_date: input.date,
    p_note: input.note,
    p_same_day: input.sameDay,
  });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.order_delivery_expectation',
    targetType: 'order',
    targetId: orderId,
    details: { sameDay: input.sameDay },
  });
  return getOrder(orderId);
}

export async function recordCodCollection(actor: Actor, orderId: string, input: { amountPaise: number; mismatchNote: string }) {
  await orderRpc('record_cod_collection', {
    p_actor: actor.staffId,
    p_order_id: orderId,
    p_amount_paise: input.amountPaise,
    p_mismatch_note: input.mismatchNote,
  });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.order_cod_collected',
    targetType: 'order',
    targetId: orderId,
    details: { amountPaise: input.amountPaise },
  });
  return getOrder(orderId);
}
