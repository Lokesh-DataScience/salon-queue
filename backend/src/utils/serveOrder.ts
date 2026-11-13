// backend/src/utils/serveOrder.ts
export interface OrderableEntry {
  status: string;
  token_number: number;
  priority_at?: string | null;
  // Set only when the barber moved a no-show back ("Not here"); otherwise the token number decides.
  order_key?: number | string | null;
}

const STATUS_RANK: Record<string, number> = { SERVING: 0, CALLED: 1, WAITING: 2 };

// Negative = a is served before b. Emergency entries (priority_at set) go first among
// WAITING, earliest bump first; everyone else keeps token order.
export function compareServeOrder(a: OrderableEntry, b: OrderableEntry): number {
  const rank = (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3);
  if (rank !== 0) return rank;
  if (a.priority_at && b.priority_at) return Date.parse(a.priority_at) - Date.parse(b.priority_at);
  if (a.priority_at) return -1;
  if (b.priority_at) return 1;
  const ka = a.order_key != null ? Number(a.order_key) : a.token_number;
  const kb = b.order_key != null ? Number(b.order_key) : b.token_number;
  if (ka !== kb) return ka - kb;
  return a.token_number - b.token_number;
}