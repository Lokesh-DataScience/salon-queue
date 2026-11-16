// backend/src/services/shopMoneyAdmin.service.ts — Commerce C5b: supplier settlement, expenses, the profit report,
// founder-callback recovery and key revocation (§4.8, §9.4, §12).
// Reads: FOUNDER + COFOUNDER (D7, including every money figure). Writes: FOUNDER only (route guard + database).
// The audit log keeps ids and amounts only: never a name, phone, address or recovery code.
import { randomInt } from 'crypto';
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { logAdminAction } from './admin.service';
import type { Actor } from './founderSalons.service';
import { shopDbError } from './shopAdmin.service';
import { recoveryCodeHash } from './shopCustomer.service';

const MESSAGES: Record<string, [number, string]> = {
  SHOP_NOT_SETTLEABLE: [409, 'One of these orders is not delivered yet or was already paid for. Refresh and check again.'],
  SHOP_MIXED_SUPPLIERS: [400, 'These orders are from different suppliers. Pay each supplier separately.'],
  SHOP_DUPLICATE_ORDERS: [400, 'The same order is in the list twice. Refresh and try again.'],
  SHOP_ALREADY_SETTLED: [409, 'This order was already paid for.'],
  SHOP_MISMATCH_NOTE_REQUIRED: [400, "The amount is different from what the orders add up to — write a short note about why."],
  SHOP_REASON_REQUIRED: [400, 'Please write a reason (at least 3 characters).'],
  SHOP_STALE: [409, 'This changed since you opened it (maybe on another device). Refresh and check again.'],
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const msg = error.message ?? '';
    const code = Object.keys(MESSAGES).find((c) => msg === c || msg.startsWith(`${c}:`));
    if (code) throw new AppError(MESSAGES[code][1], MESSAGES[code][0]);
    shopDbError(error);
  }
  return data as T;
}

const audit = (actor: Actor, action: string, targetType: string, targetId: string, details: Record<string, unknown>) =>
  logAdminAction({ actorStaffId: actor.staffId, actorRole: actor.role, action, targetType, targetId, details });

// ── Settlements ──────────────────────────────────────────────────────────

// Orders the supplier is still owed for (delivered, or cancelled with written-off goods), oldest first.
export async function pendingSettlement() {
  const rows = await rpc<
    { id: string; order_number: string; status: string; delivered_at: string | null; updated_at: string; total_paise: number;
      supplier_id: string | null; supplier_name: string | null; payable_paise: number }[]
  >('shop_pending_settlement', {});
  const orders = rows.map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    deliveredAt: o.delivered_at ?? o.updated_at,
    totalPaise: o.total_paise,
    supplierId: o.supplier_id,
    supplierName: o.supplier_name,
    payablePaise: o.payable_paise,
  }));
  return { orders, totalPayablePaise: orders.reduce((n, o) => n + o.payablePaise, 0) };
}

export async function listSettlements() {
  const { data, error } = await supabase
    .from('supplier_settlements')
    .select('id, paid_at, amount_paise, payable_paise, order_count, method, reference, note, suppliers (name), orders (order_number)')
    .order('paid_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return {
    settlements: (data ?? []).map((s) => ({
      id: s.id as string,
      paidAt: s.paid_at as string,
      amountPaise: s.amount_paise as number,
      payablePaise: s.payable_paise as number,
      orderCount: s.order_count as number,
      method: s.method as string,
      reference: s.reference as string,
      note: s.note as string,
      supplierName: (s.suppliers as unknown as { name: string } | null)?.name ?? null,
      orderNumbers: ((s.orders as unknown as { order_number: string }[]) ?? []).map((o) => o.order_number).sort(),
    })),
  };
}

export async function recordSettlement(
  actor: Actor,
  input: { orderIds: string[]; amountPaise: number; method: string; reference: string; note: string; paidAt?: string },
) {
  const r = await rpc<{ settlement_id: string; payable_paise: number; order_count: number }>('record_supplier_settlement', {
    p_actor: actor.staffId,
    p_order_ids: input.orderIds,
    p_amount_paise: input.amountPaise,
    p_method: input.method,
    p_reference: input.reference,
    p_note: input.note,
    p_paid_at: input.paidAt ?? null,
  });
  await audit(actor, 'shop.supplier_settlement', 'supplier_settlement', r.settlement_id, {
    amountPaise: input.amountPaise,
    payablePaise: r.payable_paise,
    orders: r.order_count,
  });
  return { settlementId: r.settlement_id, payablePaise: r.payable_paise, orderCount: r.order_count };
}

// ── Expenses ─────────────────────────────────────────────────────────────

export async function addExpense(actor: Actor, orderId: string, input: { kind: string; amountPaise: number; note: string }) {
  const id = await rpc<string>('record_order_expense', {
    p_actor: actor.staffId,
    p_order_id: orderId,
    p_kind: input.kind,
    p_amount_paise: input.amountPaise,
    p_note: input.note,
  });
  await audit(actor, 'shop.order_expense', 'order', orderId, { expenseId: id, kind: input.kind, amountPaise: input.amountPaise });
  return { expenseId: id };
}

export async function voidExpense(actor: Actor, expenseId: string, reason: string) {
  const orderId = await rpc<string>('void_order_expense', { p_actor: actor.staffId, p_expense_id: expenseId, p_reason: reason });
  await audit(actor, 'shop.order_expense_void', 'order', orderId, { expenseId });
  return { orderId };
}

// ── Report ───────────────────────────────────────────────────────────────

interface ReportRow {
  from: string;
  to: string;
  delivered_orders: number;
  cancelled_orders: number;
  sales_paise: number;
  collected_paise: number;
  supplier_cost_paise: number;
  expenses_paise: number;
  refunds_paid_paise: number;
  write_offs_paise: number;
  supplier_owes_back_paise: number;
  returns_waiting: number;
  refunds_pending_paise: number;
  gross_margin_paise: number;
  net_profit_paise: number;
  owed_to_supplier_paise: number;
  owed_orders: number;
  orders: {
    id: string;
    order_number: string;
    day: string;
    total_paise: number;
    collected_paise: number;
    cost_paise: number;
    expenses_paise: number;
    refunded_paise: number;
    profit_paise: number;
    settled: boolean;
  }[];
}

export async function report(from: string, to: string) {
  if (from > to) throw new AppError('The start date must be on or before the end date.', 400);
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > 366) throw new AppError('Choose at most one year at a time.', 400);
  const r = await rpc<ReportRow>('shop_finance_report', { p_from: from, p_to: to });
  return {
    from: r.from,
    to: r.to,
    deliveredOrders: r.delivered_orders,
    cancelledOrders: r.cancelled_orders,
    salesPaise: r.sales_paise,
    collectedPaise: r.collected_paise,
    supplierCostPaise: r.supplier_cost_paise,
    expensesPaise: r.expenses_paise,
    refundsPaidPaise: r.refunds_paid_paise,
    writeOffsPaise: r.write_offs_paise,
    supplierOwesBackPaise: r.supplier_owes_back_paise,
    returnsWaiting: r.returns_waiting,
    refundsPendingPaise: r.refunds_pending_paise,
    grossMarginPaise: r.gross_margin_paise,
    netProfitPaise: r.net_profit_paise,
    owedToSupplierPaise: r.owed_to_supplier_paise,
    owedOrders: r.owed_orders,
    orders: r.orders.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      day: o.day,
      totalPaise: o.total_paise,
      collectedPaise: o.collected_paise,
      costPaise: o.cost_paise,
      expensesPaise: o.expenses_paise,
      refundedPaise: o.refunded_paise,
      profitPaise: o.profit_paise,
      settled: o.settled,
    })),
  };
}

// ── Customers: recovery and phones with access ───────────────────────────

interface KeyRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export async function getCustomer(customerId: string) {
  const { data: c, error } = await supabase
    .from('shop_customers')
    .select('id, phone_e164, display_name, address_line1, address_line2, landmark, pincode, phone_verified_at, created_at')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!c) throw new AppError('Customer not found.', 404);

  const [{ data: links, error: e1 }, { data: orders, error: e2 }, { data: codes, error: e3 }] = await Promise.all([
    supabase.from('shop_profile_customers').select('profile_id, method, verified_at').eq('customer_id', customerId),
    supabase.from('orders').select('id, order_number, status, created_at, placed_by_profile_id').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    supabase
      .from('shop_verification_codes')
      .select('created_at, expires_at, used_at, attempts')
      .eq('purpose', 'RECOVERY')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  // Every phone (access profile) that can see this customer's orders: ones that placed them, and verified ones.
  const profiles = new Map<string, { verified: string | null; method: string | null; placedOrders: number }>();
  for (const o of orders ?? []) {
    const p = o.placed_by_profile_id as string | null;
    if (!p) continue;
    const cur = profiles.get(p) ?? { verified: null, method: null, placedOrders: 0 };
    cur.placedOrders += 1;
    profiles.set(p, cur);
  }
  for (const l of links ?? []) {
    const cur = profiles.get(l.profile_id as string) ?? { verified: null, method: null, placedOrders: 0 };
    cur.verified = l.verified_at as string;
    cur.method = l.method as string;
    profiles.set(l.profile_id as string, cur);
  }
  const ids = [...profiles.keys()];
  const { data: keys, error: e4 } = ids.length
    ? await supabase.from('shop_access_keys').select('id, profile_id, created_at, last_seen_at, revoked_at').in('profile_id', ids).order('created_at')
    : { data: [] as (KeyRow & { profile_id: string })[], error: null };
  if (e4) throw e4;

  return {
    customer: {
      id: c.id as string,
      name: c.display_name as string,
      phone: c.phone_e164 as string,
      addressLine1: c.address_line1 as string,
      addressLine2: c.address_line2 as string,
      landmark: c.landmark as string,
      pincode: c.pincode as string,
      phoneVerifiedAt: c.phone_verified_at as string | null,
      createdAt: c.created_at as string,
    },
    orders: (orders ?? []).map((o) => ({ id: o.id as string, orderNumber: o.order_number as string, status: o.status as string, createdAt: o.created_at as string })),
    // Shown as "Phone 1, Phone 2…": the founder never sees ids or secrets, only when each was used.
    devices: ids.map((profileId, i) => {
      const p = profiles.get(profileId)!;
      return {
        label: `Phone ${i + 1}`,
        verifiedAt: p.verified,
        verifiedBy: p.method,
        placedOrders: p.placedOrders,
        keys: ((keys ?? []) as (KeyRow & { profile_id: string })[])
          .filter((k) => k.profile_id === profileId)
          .map((k) => ({ id: k.id, createdAt: k.created_at, lastSeenAt: k.last_seen_at, revokedAt: k.revoked_at })),
      };
    }),
    recoveryCodes: (codes ?? []).map((r) => ({
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
      usedAt: r.used_at as string | null,
      wrongTries: r.attempts as number,
    })),
  };
}

// The founder has just called this customer's number. The code is shown ONCE (never stored in plain form) and
// must be read out on that call: never send it by WhatsApp or SMS to a number the customer gives you now.
export async function createRecoveryCode(actor: Actor, customerId: string) {
  const { data: c, error } = await supabase.from('shop_customers').select('phone_e164').eq('id', customerId).maybeSingle();
  if (error) throw error;
  if (!c) throw new AppError('Customer not found.', 404);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = await rpc<string>('create_recovery_code', {
    p_actor: actor.staffId,
    p_customer_id: customerId,
    p_code_hash: recoveryCodeHash(c.phone_e164 as string, code),
  });
  await audit(actor, 'shop.recovery_code', 'shop_customer', customerId, {});
  return { code: `${code.slice(0, 3)} ${code.slice(3)}`, expiresAt };
}

export async function revokeKey(actor: Actor, customerId: string, keyId: string) {
  await rpc('revoke_access_key', { p_actor: actor.staffId, p_customer_id: customerId, p_key_id: keyId });
  await audit(actor, 'shop.revoke_access_key', 'shop_customer', customerId, { keyId });
  return getCustomer(customerId);
}
