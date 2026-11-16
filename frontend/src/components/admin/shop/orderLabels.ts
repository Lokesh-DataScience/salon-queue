// frontend/src/components/admin/shop/orderLabels.ts — how order statuses read on the founder's screens.
import type { AdminOrderStatus } from '../../../api/shopAdmin';

export const ADMIN_STATUS: Record<AdminOrderStatus, string> = {
  PLACED: 'New',
  SUPPLIER_PENDING: 'Asked supplier',
  SUPPLIER_CONFIRMED: 'Supplier confirmed',
  COLLECTED: 'Collected',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERY_FAILED: 'Delivery failed',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const ADMIN_STATUS_TONE: Record<AdminOrderStatus, string> = {
  PLACED: 'border-amber-500 bg-amber-100 text-amber-900',
  SUPPLIER_PENDING: 'border-amber-400 bg-amber-50 text-amber-900',
  SUPPLIER_CONFIRMED: 'border-green-500 bg-green-50 text-green-900',
  COLLECTED: 'border-green-500 bg-green-50 text-green-900',
  OUT_FOR_DELIVERY: 'border-green-600 bg-green-100 text-green-900',
  DELIVERY_FAILED: 'border-red-400 bg-red-50 text-red-900',
  DELIVERED: 'border-gray-400 bg-gray-50 text-gray-800',
  CANCELLED: 'border-gray-300 bg-gray-50 text-gray-600',
};

export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const EVENT_TEXT: Record<string, string> = {
  placed: 'Order placed',
  same_day: 'Same-day decision',
  delivery_expectation: 'Delivery date updated',
  placed_reminder_sent: 'Reminder sent to you',
  cod_collected: 'Cash recorded',
  customer_details: 'Customer details saved',
};

export function eventLabel(e: { type: string; to: string | null }) {
  if (e.type === 'status' || e.type === 'cancelled') return ADMIN_STATUS[e.to as AdminOrderStatus] ?? e.to ?? e.type;
  if (e.type === 'cod_collected' && e.to) return `Cash recorded: ₹${(Number(e.to) / 100).toLocaleString('en-IN')}`;
  return EVENT_TEXT[e.type] ?? e.type.replace(/_/g, ' ');
}
