// frontend/src/lib/cart.ts — the shop cart on this phone (Commerce C3).
// Stores ONLY product ids, quantities and the price the customer last saw (to point out a change).
// Never a name, phone number or address. Prices that count always come from the server quote.
import { useSyncExternalStore } from 'react';

export interface CartItem {
  productId: string;
  qty: number;
  seenPricePaise: number; // the price shown when added / last confirmed
}

const KEY = 'svq.cart.v1';
export const MAX_LINES = 20;
export const MAX_QTY = 20;

function read(): CartItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (i) =>
          i && typeof i.productId === 'string' && /^[0-9a-f-]{36}$/i.test(i.productId) &&
          Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= MAX_QTY && Number.isInteger(i.seenPricePaise),
      )
      .slice(0, MAX_LINES)
      .map((i) => ({ productId: i.productId, qty: i.qty, seenPricePaise: i.seenPricePaise }));
  } catch {
    return [];
  }
}

let items: CartItem[] = read();
const listeners = new Set<() => void>();

function write(next: CartItem[]) {
  items = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the cart lasts until the page closes */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, () => items, () => items);
}

export function cartCount(list: CartItem[] = items) {
  return list.reduce((n, i) => n + i.qty, 0);
}

// Adds qty (capped at max). Returns false if the cart already has 20 different products.
export function addToCart(productId: string, qty: number, pricePaise: number, max = MAX_QTY): boolean {
  const existing = items.find((i) => i.productId === productId);
  if (!existing && items.length >= MAX_LINES) return false;
  const nextQty = Math.min(max, MAX_QTY, (existing?.qty ?? 0) + qty);
  write(
    existing
      ? items.map((i) => (i.productId === productId ? { ...i, qty: nextQty, seenPricePaise: pricePaise } : i))
      : [...items, { productId, qty: Math.max(1, nextQty), seenPricePaise: pricePaise }],
  );
  return true;
}

export function setQty(productId: string, qty: number) {
  if (qty < 1) return removeFromCart(productId);
  write(items.map((i) => (i.productId === productId ? { ...i, qty: Math.min(qty, MAX_QTY) } : i)));
}

export function removeFromCart(productId: string) {
  write(items.filter((i) => i.productId !== productId));
}

// After the customer has seen the new prices, remember them so the notice goes away.
export function acceptPrices(prices: Record<string, number>) {
  write(items.map((i) => (prices[i.productId] !== undefined ? { ...i, seenPricePaise: prices[i.productId] } : i)));
}

export function clearCart() {
  write([]);
}

// Tests only.
export function resetCartForTests() {
  items = read();
  listeners.forEach((l) => l());
}
