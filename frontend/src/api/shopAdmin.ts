// frontend/src/api/shopAdmin.ts — Shop admin (Commerce Phase 1, C1). Founder + Cofounder read; Founder writes.
// Every write carries the admin CSRF token. The token lives in this module's memory only (never in
// localStorage, sessionStorage or the address bar); it is fetched on first use and once more on a 403.
import { apiFetch, ApiError } from './client';

export interface ShopImage {
  id: string;
  url: string;
  sortOrder: number;
  alt: string;
}

export interface ShopProduct {
  id: string;
  sku: string;
  name: string;
  brand: string;
  description: string;
  categoryId: string | null;
  mrpPaise: number;
  sellingPricePaise: number;
  wholesaleCostPaise: number;
  marginPaise: number;
  marginWarning: boolean;
  stockOnHand: number;
  stockReserved: number;
  stockBuffer: number;
  sellable: number;
  maxPerOrder: number;
  isActive: boolean;
  isVisible: boolean;
  sameDayEligible: boolean;
  lastStockCheckAt: string | null;
  deletedAt: string | null;
  updatedAt: string;
  images: ShopImage[];
}

export interface ShopCategory {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string;
  sortOrder: number;
  isActive: boolean;
}

export type StockChangeType = 'STOCK_COUNT' | 'MANUAL_ADJUSTMENT' | 'DAMAGED_STOCK';

export interface ShopMovement {
  id: number;
  type: string;
  qtyChange: number;
  onHandBefore: number;
  onHandAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  reason: string;
  actorType: string;
  actorName: string | null;
  createdAt: string;
}

export interface ShopSettings {
  sameDayCutoff: string | null;
  codMaxOrderPaise: number;
  maxOpenCodOrdersPerCustomer: number;
  founderContactPhone: string;
  placedReminderAfterMinutes: number;
  placedReminderRepeatMinutes: number;
  updatedAt: string;
}

export interface ShopSupplier {
  id: string;
  name: string;
  phone: string;
  notes: string;
}

export interface ProductInput {
  categoryId?: string | null;
  sku?: string;
  name?: string;
  description?: string;
  brand?: string;
  mrpPaise?: number;
  sellingPricePaise?: number;
  wholesaleCostPaise?: number;
  stockBuffer?: number;
  maxPerOrder?: number;
  isActive?: boolean;
  sameDayEligible?: boolean;
}

const BASE = '/api/admin/shop';

// ── CSRF token (memory only) ─────────────────────────────────────────────
let csrf: { token: string; expiresAt: number } | null = null;
let csrfInFlight: Promise<string> | null = null;

async function csrfToken(force = false): Promise<string> {
  if (!force && csrf && csrf.expiresAt - Date.now() > 60_000) return csrf.token;
  csrfInFlight ??= apiFetch<{ csrfToken: string; expiresAt: string }>(`${BASE}/session`, { method: 'POST', body: '{}' })
    .then((r) => {
      csrf = { token: r.csrfToken, expiresAt: Date.parse(r.expiresAt) };
      return r.csrfToken;
    })
    .finally(() => {
      csrfInFlight = null;
    });
  return csrfInFlight;
}

// Test hook: forget the token.
export function resetShopCsrf() {
  csrf = null;
}

async function write<T>(path: string, init: { method: string; body?: BodyInit; headers?: Record<string, string> }): Promise<T> {
  const go = async (force: boolean) =>
    apiFetch<T>(`${BASE}${path}`, {
      method: init.method,
      body: init.body ?? '{}',
      headers: { ...(init.headers ?? {}), 'X-Admin-CSRF': await csrfToken(force) },
    });
  try {
    return await go(false);
  } catch (err) {
    // An expired token is refused with 403 before anything runs, so one retry with a fresh token is safe.
    // A Cofounder's 403 comes back again on the retry and is shown as-is.
    if (err instanceof ApiError && err.status === 403 && err.message.startsWith('This request was blocked')) {
      return go(true);
    }
    throw err;
  }
}
const json = (method: string, path: string, body: unknown) => write(path, { method, body: JSON.stringify(body) });

// ── Reads ────────────────────────────────────────────────────────────────
export function fetchShopProducts(q: { search?: string; categoryId?: string } = {}) {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.categoryId) p.set('categoryId', q.categoryId);
  const qs = p.toString();
  return apiFetch<{ products: ShopProduct[] }>(`${BASE}/products${qs ? `?${qs}` : ''}`).then((r) => r.products);
}
export const fetchShopProduct = (id: string) =>
  apiFetch<{ product: ShopProduct }>(`${BASE}/products/${id}`).then((r) => r.product);
export const fetchShopMovements = (id: string) =>
  apiFetch<{ movements: ShopMovement[] }>(`${BASE}/products/${id}/movements?limit=100`).then((r) => r.movements);
export const fetchShopCategories = () =>
  apiFetch<{ categories: ShopCategory[] }>(`${BASE}/categories`).then((r) => r.categories);
export const fetchShopSettings = () => apiFetch<{ settings: ShopSettings; supplier: ShopSupplier | null }>(`${BASE}/settings`);

// ── Writes (founder) ─────────────────────────────────────────────────────
type One = { product: ShopProduct };
export const createShopProduct = (input: ProductInput & { initialStock: number }) =>
  json('POST', '/products', input).then((r) => (r as One).product);
export const updateShopProduct = (id: string, input: ProductInput) =>
  json('PATCH', `/products/${id}`, input).then((r) => (r as One).product);
export const deleteShopProduct = (id: string) => json('DELETE', `/products/${id}`, {});
export const setShopAvailability = (id: string, available: boolean) =>
  json('POST', `/products/${id}/availability`, { available }).then((r) => (r as One).product);
export const changeShopStock = (
  id: string,
  input: { type: StockChangeType; qty: number; expectedOnHand: number; reason: string },
) => json('POST', `/products/${id}/stock`, input).then((r) => (r as One).product);
export const submitStockCheck = (items: { productId: string; counted: number; expectedOnHand: number }[]) =>
  json('POST', '/stock/check', { items }) as Promise<{ checked: number; changed: number }>;

export const uploadShopImage = (id: string, file: File, alt = '') =>
  write<One>(`/products/${id}/images${alt ? `?alt=${encodeURIComponent(alt)}` : ''}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type },
  }).then((r) => r.product);
export const updateShopImage = (id: string, imageId: string, input: { sortOrder?: number; alt?: string }) =>
  json('PATCH', `/products/${id}/images/${imageId}`, input).then((r) => (r as One).product);
export const deleteShopImage = (id: string, imageId: string) =>
  json('DELETE', `/products/${id}/images/${imageId}`, {}).then((r) => (r as One).product);

export const createShopCategory = (input: Omit<ShopCategory, 'id'>) =>
  json('POST', '/categories', input).then((r) => (r as { category: ShopCategory }).category);
export const updateShopCategory = (id: string, input: Partial<Omit<ShopCategory, 'id'>>) =>
  json('PATCH', `/categories/${id}`, input).then((r) => (r as { category: ShopCategory }).category);

type SettingsResult = { settings: ShopSettings; supplier: ShopSupplier | null };
export const updateShopSettings = (input: Partial<Omit<ShopSettings, 'updatedAt'>>) =>
  json('PATCH', '/settings', input) as Promise<SettingsResult>;
export const updateShopSupplier = (input: Partial<Omit<ShopSupplier, 'id'>>) =>
  json('PATCH', '/supplier', input) as Promise<SettingsResult>;

// ── Money helpers (paise ⇄ rupees) ───────────────────────────────────────
// ── Orders (C5a) ─────────────────────────────────────────────────────────
export type AdminOrderStatus =
  | 'PLACED' | 'SUPPLIER_PENDING' | 'SUPPLIER_CONFIRMED' | 'COLLECTED' | 'OUT_FOR_DELIVERY' | 'DELIVERY_FAILED' | 'DELIVERED' | 'CANCELLED';
export type SameDayState = 'NOT_REQUESTED' | 'REQUESTED' | 'CONFIRMED' | 'NOT_POSSIBLE';

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  status: AdminOrderStatus;
  paymentStatus: string;
  totalPaise: number;
  itemCount: number;
  sameDayState: SameDayState;
  expectedDeliveryDate: string | null;
  customerName: string;
  pincode: string;
  createdAt: string;
  updatedAt: string;
  remindersSent: number;
  needs: 'STOCK_DECISION' | 'RETURN' | 'REFUND' | null;
}

export interface AdminOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  sku: string;
  mrpPaise: number;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
  expectedUnitCostPaise: number;
  confirmedUnitCostPaise: number | null;
  stockState: string;
  cancelRestockQty: number;
  cancelWriteOffQty: number;
  returnedQty: number;
  keptUnits: number;
  lineProfitPaise: number;
}

export interface OrderReturn {
  id: string;
  itemId: string;
  quantity: number;
  status: 'RECEIVED' | 'RESOLVED' | 'REJECTED';
  restockQty: number;
  writeOffQty: number;
  reason: string;
  decisionNote: string;
  refundPaise: number;
  refundStatus: 'NONE' | 'PENDING' | 'PAID';
  refundMethod: string | null;
  refundPaidAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminOrderDetail {
  order: {
    id: string;
    orderNumber: string;
    customerId: string;
    status: AdminOrderStatus;
    paymentMethod: string;
    paymentStatus: string;
    createdAt: string;
    updatedAt: string;
    deliveredAt: string | null;
    customer: { name: string; phone: string; addressLine1: string; addressLine2: string; landmark: string; pincode: string };
    subtotalPaise: number;
    deliveryFeePaise: number;
    totalPaise: number;
    sameDayState: SameDayState;
    expectedDeliveryDate: string | null;
    expectedDeliveryNote: string;
    cod: { collectedPaise: number | null; collectedAt: string | null; mismatchNote: string };
    supplier: { name: string; phone: string } | null;
    supplierContactedAt: string | null;
    fromSalon: boolean;
    cancelReason: string | null;
    cancelledBy: string | null;
    remindersSent: number;
    supplierSettled: boolean;
  };
  items: AdminOrderItem[];
  finance: {
    costPaise: number;
    grossProfitPaise: number;
    costsConfirmed: boolean;
    expensesPaise: number;
    netProfitPaise: number;
    refundedPaise?: number;
    refundPendingPaise?: number;
  };
  expenses: OrderExpense[];
  returns?: OrderReturn[];
  events: { id: string; type: string; from: string | null; to: string | null; customerVisible: boolean; note: string; actorType: string; at: string }[];
}

export type OrderListFilter = 'open' | 'all' | 'attention' | AdminOrderStatus;

export function fetchShopOrders(q: { status: OrderListFilter; search?: string }) {
  const p = new URLSearchParams({ status: q.status });
  if (q.search) p.set('search', q.search);
  return apiFetch<{
    orders: AdminOrderSummary[];
    counts: Partial<Record<AdminOrderStatus, number>>;
    attention?: { stockDecisions: number; returns: number; refunds: number; total: number };
  }>(`${BASE}/orders?${p}`);
}
export const fetchShopOrder = (id: string) => apiFetch<AdminOrderDetail>(`${BASE}/orders/${id}`);
export const fetchSupplierText = (id: string) =>
  apiFetch<{ text: string; supplierName: string | null; whatsappUrl: string | null }>(`${BASE}/orders/${id}/supplier-text`);

export interface TransitionInput {
  expectedFrom: AdminOrderStatus;
  to: Exclude<AdminOrderStatus, 'PLACED' | 'DELIVERED'>;
  note?: string;
  lines?: { itemId: string; confirmedUnitCostPaise: number }[];
  delivery?: { date?: string | null; note?: string; sameDay?: 'CONFIRMED' | 'NOT_POSSIBLE' };
  markOutOfStock?: boolean;
}
export const transitionShopOrder = (id: string, input: TransitionInput) =>
  json('POST', `/orders/${id}/transition`, input) as Promise<AdminOrderDetail>;
export const setShopDeliveryExpectation = (
  id: string,
  input: { date: string | null; note: string; sameDay: 'CONFIRMED' | 'NOT_POSSIBLE' | null },
) => json('POST', `/orders/${id}/delivery-expectation`, input) as Promise<AdminOrderDetail>;
export const recordShopCod = (id: string, input: { amountPaise: number; mismatchNote: string }) =>
  json('POST', `/orders/${id}/cod-collection`, input) as Promise<AdminOrderDetail>;

// ── Money and recovery (C5b) ─────────────────────────────────────────────
export type ExpenseKind = 'TRAVEL' | 'PACKAGING' | 'DELIVERY' | 'OTHER';
export interface OrderExpense {
  id: string;
  kind: ExpenseKind;
  amountPaise: number;
  note: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string;
}
export const addShopExpense = (orderId: string, input: { kind: ExpenseKind; amountPaise: number; note: string }) =>
  json('POST', `/orders/${orderId}/expenses`, input) as Promise<AdminOrderDetail>;
export const voidShopExpense = (expenseId: string, reason: string) =>
  json('POST', `/expenses/${expenseId}/void`, { reason }) as Promise<AdminOrderDetail>;

export interface PendingSettlementOrder {
  id: string;
  orderNumber: string;
  status?: string;
  deliveredAt: string;
  totalPaise: number;
  supplierId: string | null;
  supplierName: string | null;
  payablePaise: number;
}
export type SettlementMethod = 'CASH' | 'UPI' | 'BANK' | 'OTHER';
export interface Settlement {
  id: string;
  paidAt: string;
  amountPaise: number;
  payablePaise: number;
  orderCount: number;
  method: SettlementMethod;
  reference: string;
  note: string;
  supplierName: string | null;
  orderNumbers: string[];
}
export const fetchPendingSettlement = () =>
  apiFetch<{ orders: PendingSettlementOrder[]; totalPayablePaise: number }>(`${BASE}/settlements/pending`);
export const fetchSettlements = () => apiFetch<{ settlements: Settlement[] }>(`${BASE}/settlements`);
export const recordSettlement = (input: { orderIds: string[]; amountPaise: number; method: SettlementMethod; reference: string; note: string }) =>
  json('POST', '/settlements', input) as Promise<{ settlementId: string; payablePaise: number; orderCount: number }>;

export interface ShopReport {
  from: string;
  to: string;
  deliveredOrders: number;
  cancelledOrders: number;
  salesPaise: number;
  collectedPaise: number;
  supplierCostPaise: number;
  expensesPaise: number;
  refundsPaidPaise: number;
  writeOffsPaise?: number;
  supplierOwesBackPaise?: number;
  returnsWaiting?: number;
  refundsPendingPaise?: number;
  grossMarginPaise: number;
  netProfitPaise: number;
  owedToSupplierPaise: number;
  owedOrders: number;
  orders: {
    id: string;
    orderNumber: string;
    day: string;
    totalPaise: number;
    collectedPaise: number;
    costPaise: number;
    expensesPaise: number;
    refundedPaise?: number;
    profitPaise: number;
    settled: boolean;
  }[];
}
export const fetchShopReport = (from: string, to: string) =>
  apiFetch<ShopReport>(`${BASE}/report?${new URLSearchParams({ from, to })}`);

export interface ShopCustomerAccess {
  customer: {
    id: string;
    name: string;
    phone: string;
    addressLine1: string;
    addressLine2: string;
    landmark: string;
    pincode: string;
    phoneVerifiedAt: string | null;
    createdAt: string;
  };
  orders: { id: string; orderNumber: string; status: AdminOrderStatus; createdAt: string }[];
  devices: {
    label: string;
    verifiedAt: string | null;
    verifiedBy: string | null;
    placedOrders: number;
    keys: { id: string; createdAt: string; lastSeenAt: string; revokedAt: string | null }[];
  }[];
  recoveryCodes: { createdAt: string; expiresAt: string; usedAt: string | null; wrongTries: number }[];
}
export const fetchShopCustomer = (id: string) => apiFetch<ShopCustomerAccess>(`${BASE}/customers/${id}`);
export const createRecoveryCode = (customerId: string) =>
  json('POST', `/customers/${customerId}/recovery-code`, {}) as Promise<{ code: string; expiresAt: string }>;
export const revokeShopKey = (customerId: string, keyId: string) =>
  json('POST', `/customers/${customerId}/keys/${keyId}/revoke`, {}) as Promise<ShopCustomerAccess>;

// ── Stock decisions, returns, refunds (C6) ───────────────────────────────
export const disposeShopLine = (orderId: string, lineId: string, input: { backToSupplierQty: number; writeOffQty: number; note: string }) =>
  json('POST', `/orders/${orderId}/lines/${lineId}/disposition`, input) as Promise<AdminOrderDetail>;
export const recordShopReturn = (orderId: string, lineId: string, input: { quantity: number; reason: string }) =>
  json('POST', `/orders/${orderId}/lines/${lineId}/returns`, input) as Promise<AdminOrderDetail>;
export const resolveShopReturn = (
  returnId: string,
  input: { decision: 'RESOLVED' | 'REJECTED'; backToSupplierQty: number; writeOffQty: number; refundPaise: number; note: string },
) => json('POST', `/returns/${returnId}/resolve`, input) as Promise<AdminOrderDetail>;
export const markShopRefundPaid = (returnId: string, method: 'CASH' | 'UPI' | 'OTHER') =>
  json('POST', `/returns/${returnId}/refund-paid`, { method }) as Promise<AdminOrderDetail>;

export { rupees } from '../lib/money';

// "249" or "249.50" → 24950. Returns null for anything else.
export function toPaise(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  const [r, p = ''] = t.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}
export const paiseToInput = (paise: number) => (paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100));
