// frontend/src/api/shopOrders.ts — the customer's orders (Commerce C4). Reads use the device cookie only;
// changes go through shopWrite (CSRF token in memory).
import { apiFetch } from './client';
import type { Quote } from './shop';
import { shopWrite, ShopHttpError } from '../lib/shopSession';

export type OrderStatus =
  | 'PLACED' | 'SUPPLIER_PENDING' | 'SUPPLIER_CONFIRMED' | 'COLLECTED'
  | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'DELIVERY_FAILED' | 'CANCELLED';

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalPaise: number;
  sameDayState: string;
  createdAt: string;
  itemCount: number;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  deliveredAt: string | null;
  sameDayState: 'NOT_REQUESTED' | 'REQUESTED' | 'CONFIRMED' | 'NOT_POSSIBLE';
  expectedDeliveryDate: string | null;
  expectedDeliveryNote: string;
  cancelReason: string;
  cancelledBy: 'CUSTOMER' | 'FOUNDER' | null;
  canCancel: boolean;
  delivery: { name: string; phone: string; addressLine1: string; addressLine2: string; landmark: string; pincode: string };
  items: { productId: string | null; name: string; qty: number; unitPricePaise: number; mrpPaise: number; lineTotalPaise: number }[];
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  timeline: { type: string; to: string | null; note: string; at: string }[];
  contactPhone: string | null;
}

export interface CustomerDetails {
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  landmark: string;
  pincode: string;
}

export const fetchMyOrders = () => apiFetch<{ orders: OrderSummary[] }>('/api/shop/orders').then((r) => r.orders);
export const fetchMyOrder = (id: string) =>
  apiFetch<{ order: OrderDetail }>(`/api/shop/orders/${encodeURIComponent(id)}`).then((r) => r.order);
export const fetchPrefill = () =>
  apiFetch<{ prefill: (CustomerDetails & { source: string }) | null }>('/api/shop/prefill').then((r) => r.prefill);

export async function cancelMyOrder(id: string, reason: string): Promise<OrderDetail> {
  const r = await shopWrite(`/api/shop/orders/${encodeURIComponent(id)}/cancel`, { reason });
  if (!r.ok) throw new ShopHttpError(r.status, r.body);
  return (r.body as { order: OrderDetail }).order;
}

export type PlaceResult =
  | { kind: 'CREATED' | 'EXISTING'; orderId: string; orderNumber: string }
  | { kind: 'PRICE_CHANGED' | 'CART_PROBLEM'; quote: Quote; message: string }
  | { kind: 'TOO_MANY_OPEN_ORDERS'; message: string }
  | { kind: 'IDEMPOTENCY_MISMATCH'; message: string }
  | { kind: 'INVALID'; message: string; fieldErrors?: Record<string, string[] | undefined> }
  | { kind: 'UNKNOWN'; message: string }; // couldn't reach the server, or it failed: the order MAY exist

export async function placeOrder(
  idempotencyKey: string,
  body: {
    items: { productId: string; qty: number }[];
    expectedTotalPaise: number;
    customer: CustomerDetails;
    consent: true;
    requestSameDay: boolean;
  },
): Promise<PlaceResult> {
  let r: Awaited<ReturnType<typeof shopWrite>>;
  try {
    r = await shopWrite('/api/shop/orders', body, { 'Idempotency-Key': idempotencyKey });
  } catch {
    return { kind: 'UNKNOWN', message: '' };
  }
  const msg = String(r.body.message ?? '');
  if (r.status === 201 || r.status === 200) {
    const o = r.body.order as { id: string; orderNumber: string };
    return { kind: r.status === 201 ? 'CREATED' : 'EXISTING', orderId: o.id, orderNumber: o.orderNumber };
  }
  const code = r.body.code;
  if (code === 'PRICE_CHANGED' || code === 'CART_PROBLEM') return { kind: code, quote: r.body.quote as Quote, message: msg };
  if (code === 'TOO_MANY_OPEN_ORDERS') return { kind: code, message: msg };
  if (code === 'IDEMPOTENCY_MISMATCH') return { kind: code, message: msg };
  if (r.status === 400 || r.status === 409 || r.status === 403 || r.status === 429 || r.status === 404) {
    return { kind: 'INVALID', message: msg, fieldErrors: r.body.errors as Record<string, string[] | undefined> | undefined };
  }
  return { kind: 'UNKNOWN', message: msg }; // 5xx: treat as "may have gone through"
}
