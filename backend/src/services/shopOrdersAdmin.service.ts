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
  SHOP_DISPOSITION_QTY: [400, 'The numbers must add up to the quantity of this item.'],
  SHOP_RETURN_TOO_MANY: [400, 'That is more than the customer still has of this item.'],
  SHOP_REFUND_TOO_HIGH: [400, 'That refund is too high: it can be at most the price of the returned units, and never more than the cash you collected minus earlier refunds.'],
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

// C6: orders that need the founder even though they are finished: a stock decision for cancelled goods,
// a return to decide, or a refund to hand over. Before step25 there are none.
async function attentionIds(): Promise<{ decisions: string[]; returns: string[]; refunds: string[] }> {
  const [a, b] = await Promise.all([
    supabase.from('order_items').select('order_id').eq('stock_state', 'AWAITING_DISPOSITION').limit(500),
    supabase.from('order_returns').select('order_id, status, refund_status').or('status.eq.RECEIVED,refund_status.eq.PENDING').limit(500),
  ]);
  if (a.error) throw a.error;
  const missing = b.error && (b.error.code === '42P01' || b.error.code === 'PGRST205');
  if (b.error && !missing) throw b.error;
  const rows = missing ? [] : (b.data ?? []);
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    decisions: uniq((a.data ?? []).map((r) => r.order_id as string)),
    returns: uniq(rows.filter((r) => r.status === 'RECEIVED').map((r) => r.order_id as string)),
    refunds: uniq(rows.filter((r) => r.refund_status === 'PENDING').map((r) => r.order_id as string)),
  };
}

export async function listOrders(q: { status: string; search?: string; limit: number }) {
  const attention = await attentionIds();
  let query = supabase.from('orders').select(LIST_COLUMNS).order('created_at', { ascending: false }).limit(q.limit);
  if (q.status === 'open') query = query.in('status', OPEN);
  else if (q.status === 'attention') {
    query = query.in('id', [...new Set([...attention.decisions, ...attention.returns, ...attention.refunds])].concat('00000000-0000-0000-0000-000000000000'));
  } else if (q.status !== 'all') query = query.eq('status', q.status);
  const digits = (q.search ?? '').replace(/\D/g, '');
  if (digits) query = query.eq('order_number', `SQ-${digits}`);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as ListRow[];
  const counts = await statusCounts();
  const flag = (id: string) =>
    attention.decisions.includes(id) ? 'STOCK_DECISION' : attention.returns.includes(id) ? 'RETURN' : attention.refunds.includes(id) ? 'REFUND' : null;
  return {
    counts,
    attention: {
      stockDecisions: attention.decisions.length,
      returns: attention.returns.length,
      refunds: attention.refunds.length,
      total: new Set([...attention.decisions, ...attention.returns, ...attention.refunds]).size,
    },
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
      needs: flag(r.id),
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
  const [{ data: o, error: e1 }, { data: items, error: e2 }, { data: events, error: e3 }, { data: expenses, error: e4 }] = await Promise.all([
    supabase.from('orders').select('*, suppliers (name, phone)').eq('id', orderId).maybeSingle(),
    supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)
      .order('product_name'),
    supabase
      .from('order_events')
      .select('id, event_type, from_value, to_value, customer_visible, note, actor_type, created_at')
      .eq('order_id', orderId)
      .order('created_at')
      .order('id'),
    // C5b: before step24b this table doesn't exist yet: the order still opens.
    supabase.from('order_expenses').select('id, kind, amount_paise, note, created_at, voided_at, void_reason').eq('order_id', orderId).order('created_at'),
  ]);
  // C6: before step25 this table doesn't exist yet: the order still opens.
  const { data: returns, error: e5 } = await supabase
    .from('order_returns')
    .select('id, order_item_id, quantity, status, restock_qty, write_off_qty, reason, condition_note, refund_paise, refund_status, refund_method, refund_paid_at, created_at, resolved_at')
    .eq('order_id', orderId)
    .order('created_at');
  if (e5 && e5.code !== '42P01' && e5.code !== 'PGRST205') throw e5;
  const returnRows = (e5 ? [] : (returns ?? [])).map((r) => ({
    id: r.id as string,
    itemId: r.order_item_id as string,
    quantity: r.quantity as number,
    status: r.status as 'RECEIVED' | 'RESOLVED' | 'REJECTED',
    restockQty: r.restock_qty as number,
    writeOffQty: r.write_off_qty as number,
    reason: r.reason as string,
    decisionNote: r.condition_note as string,
    refundPaise: r.refund_paise as number,
    refundStatus: r.refund_status as 'NONE' | 'PENDING' | 'PAID',
    refundMethod: r.refund_method as string | null,
    refundPaidAt: r.refund_paid_at as string | null,
    createdAt: r.created_at as string,
    resolvedAt: r.resolved_at as string | null,
  }));
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4 && e4.code !== '42P01' && e4.code !== 'PGRST205') throw e4;
  if (!o) throw new AppError('Order not found. Refresh the list.', 404);

  // Units the founder keeps (and pays the supplier for): released lines none; minus what went back to the supplier.
  const keptUnits = (i: Record<string, unknown>) => {
    if (i.stock_state === 'RELEASED') return 0;
    const restockedReturns = returnRows.filter((r) => r.itemId === i.id && r.status === 'RESOLVED').reduce((n, r) => n + r.restockQty, 0);
    return (i.quantity as number) - ((i.cancel_restock_qty as number) ?? 0) - restockedReturns;
  };
  const lines = (items ?? []).map((i) => {
    const cost = (i.confirmed_unit_cost_paise ?? i.expected_unit_cost_paise) as number;
    const kept = keptUnits(i);
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
      cancelRestockQty: (i.cancel_restock_qty as number) ?? 0,
      cancelWriteOffQty: (i.cancel_write_off_qty as number) ?? 0,
      returnedQty: (i.returned_qty as number | undefined) ?? 0,
      keptUnits: kept,
      lineProfitPaise: (i.line_total_paise as number) - cost * kept,
    };
  });
  const costPaise = lines.reduce((n, l) => n + (l.confirmedUnitCostPaise ?? l.expectedUnitCostPaise) * l.keptUnits, 0);
  const refundedPaise = returnRows.filter((r) => r.refundStatus === 'PAID').reduce((n, r) => n + r.refundPaise, 0);
  const refundPendingPaise = returnRows.filter((r) => r.refundStatus === 'PENDING').reduce((n, r) => n + r.refundPaise, 0);
  const allConfirmed = lines.every((l) => l.confirmedUnitCostPaise !== null);
  const supplier = o.suppliers as { name: string; phone: string } | null;
  const expenseRows = (e4 ? [] : (expenses ?? [])).map((x) => ({
    id: x.id as string,
    kind: x.kind as string,
    amountPaise: x.amount_paise as number,
    note: x.note as string,
    createdAt: x.created_at as string,
    voidedAt: x.voided_at as string | null,
    voidReason: x.void_reason as string,
  }));
  const expensesPaise = expenseRows.filter((x) => !x.voidedAt).reduce((n, x) => n + x.amountPaise, 0);

  return {
    order: {
      id: o.id as string,
      orderNumber: o.order_number as string,
      customerId: o.customer_id as string,
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
      supplierSettled: Boolean(o.supplier_settlement_id),
    },
    items: lines,
    // Expected until the supplier confirms rates (T3), then confirmed.
    // net uses the cash actually collected once delivered; before that, the order total
    finance: {
      costPaise,
      grossProfitPaise: (o.total_paise as number) - costPaise,
      costsConfirmed: allConfirmed,
      expensesPaise,
      refundedPaise,
      refundPendingPaise,
      // a cancelled order earns nothing: what is left is the cost of what was written off, plus expenses
      netProfitPaise:
        (o.status === 'CANCELLED' ? 0 : ((o.cod_collected_paise as number | null) ?? (o.total_paise as number)))
        - refundedPaise - refundPendingPaise - costPaise - expensesPaise,
    },
    expenses: expenseRows,
    returns: returnRows,
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

// ── C6: stock decisions, returns, refunds (§13) ─────────────────────────

export async function disposeLine(actor: Actor, orderId: string, itemId: string, input: { backToSupplierQty: number; writeOffQty: number; note: string }) {
  await orderRpc('shop_dispose_line', {
    p_actor: actor.staffId, p_order_id: orderId, p_item_id: itemId,
    p_restock_qty: input.backToSupplierQty, p_write_off_qty: input.writeOffQty, p_note: input.note,
  });
  await logAdminAction({
    actorStaffId: actor.staffId, actorRole: actor.role, action: 'shop.stock_decision', targetType: 'order', targetId: orderId,
    details: { itemId, backToSupplier: input.backToSupplierQty, writtenOff: input.writeOffQty },
  });
  return getOrder(orderId);
}

export async function recordReturn(actor: Actor, orderId: string, itemId: string, input: { quantity: number; reason: string }) {
  const returnId = await orderRpc<string>('record_return', {
    p_actor: actor.staffId, p_order_id: orderId, p_item_id: itemId, p_qty: input.quantity, p_reason: input.reason,
  });
  await logAdminAction({
    actorStaffId: actor.staffId, actorRole: actor.role, action: 'shop.return_received', targetType: 'order', targetId: orderId,
    details: { returnId, itemId, quantity: input.quantity },
  });
  return getOrder(orderId);
}

export async function resolveReturn(
  actor: Actor,
  returnId: string,
  input: { decision: 'RESOLVED' | 'REJECTED'; backToSupplierQty: number; writeOffQty: number; refundPaise: number; note: string },
) {
  const orderId = await orderRpc<string>('resolve_return', {
    p_actor: actor.staffId, p_return_id: returnId, p_decision: input.decision,
    p_restock_qty: input.backToSupplierQty, p_write_off_qty: input.writeOffQty, p_refund_paise: input.refundPaise, p_note: input.note,
  });
  await logAdminAction({
    actorStaffId: actor.staffId, actorRole: actor.role, action: 'shop.return_resolved', targetType: 'order', targetId: orderId,
    details: { returnId, decision: input.decision, backToSupplier: input.backToSupplierQty, writtenOff: input.writeOffQty, refundPaise: input.refundPaise },
  });
  return getOrder(orderId);
}

export async function markRefundPaid(actor: Actor, returnId: string, method: 'CASH' | 'UPI' | 'OTHER') {
  const orderId = await orderRpc<string>('mark_refund_paid', { p_actor: actor.staffId, p_return_id: returnId, p_method: method });
  await logAdminAction({
    actorStaffId: actor.staffId, actorRole: actor.role, action: 'shop.refund_paid', targetType: 'order', targetId: orderId,
    details: { returnId, method },
  });
  return getOrder(orderId);
}
