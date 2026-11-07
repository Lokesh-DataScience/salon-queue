// backend/src/utils/serveOrder.ts
export interface OrderableEntry {
  status: string;
  token_number: number;
  priority_at?: string | null;
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
  return a.token_number - b.token_number;
}