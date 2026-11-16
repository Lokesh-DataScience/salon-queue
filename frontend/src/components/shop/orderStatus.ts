// frontend/src/components/shop/orderStatus.ts — how an order's status reads to the customer (hi / en).
import type { OrderStatus } from '../../api/shopOrders';

export const STATUS_TEXT: Record<'hi' | 'en', Record<OrderStatus, string>> = {
  hi: {
    PLACED: 'ऑर्डर मिल गया — जल्द कन्फ़र्म करेंगे',
    SUPPLIER_PENDING: 'स्टॉक देख रहे हैं',
    SUPPLIER_CONFIRMED: 'कन्फ़र्म हो गया',
    COLLECTED: 'पैक हो गया, जल्द निकलेगा',
    OUT_FOR_DELIVERY: 'डिलीवरी के लिए निकल गया',
    DELIVERED: 'पहुँच गया',
    DELIVERY_FAILED: 'डिलीवरी नहीं हो पाई — फिर कोशिश करेंगे',
    CANCELLED: 'रद्द हो गया',
  },
  en: {
    PLACED: "Order received — we'll confirm soon",
    SUPPLIER_PENDING: 'Checking stock',
    SUPPLIER_CONFIRMED: 'Confirmed',
    COLLECTED: 'Packed, leaving soon',
    OUT_FOR_DELIVERY: 'Out for delivery',
    DELIVERED: 'Delivered',
    DELIVERY_FAILED: "Delivery missed — we'll try again",
    CANCELLED: 'Cancelled',
  },
};

export const STATUS_TONE: Record<OrderStatus, string> = {
  PLACED: 'border-amber-400 bg-amber-50 text-amber-900',
  SUPPLIER_PENDING: 'border-amber-400 bg-amber-50 text-amber-900',
  SUPPLIER_CONFIRMED: 'border-green-500 bg-green-50 text-green-900',
  COLLECTED: 'border-green-500 bg-green-50 text-green-900',
  OUT_FOR_DELIVERY: 'border-green-500 bg-green-50 text-green-900',
  DELIVERED: 'border-gray-300 bg-gray-50 text-gray-800',
  DELIVERY_FAILED: 'border-red-300 bg-red-50 text-red-900',
  CANCELLED: 'border-gray-300 bg-gray-50 text-gray-700',
};

export const fmtDateTime = (iso: string, lang: 'hi' | 'en') =>
  new Date(iso).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
