// Only ticket identifiers live here. Never a name or phone number (spec §20).
// frontend/src/lib/activeTickets.ts
const KEY = 'svq.tickets.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_TICKETS = 5;

export interface StoredTicket {
  ticketId: string;
  accessToken: string;
  salonId: string;
  tokenNumber: number;
  savedAt: number;
}

function isStored(x: unknown): x is StoredTicket {
  const t = x as Partial<StoredTicket> | null;
  return (
    !!t &&
    typeof t.ticketId === 'string' &&
    typeof t.accessToken === 'string' &&
    typeof t.salonId === 'string' &&
    typeof t.tokenNumber === 'number' &&
    typeof t.savedAt === 'number'
  );
}

// Every storage call is wrapped: private mode, blocked storage or a corrupt value
// must degrade to "no saved tickets", never crash the page.
function read(): StoredTicket[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(isStored).filter((t) => now - t.savedAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function write(list: StoredTicket[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_TICKETS)));
  } catch {
    /* storage unavailable: resume simply won't work on this browser */
  }
}

export function getTickets(salonId?: string): StoredTicket[] {
  const all = read();
  return salonId ? all.filter((t) => t.salonId === salonId) : all;
}

export function saveTicket(t: Omit<StoredTicket, 'savedAt'>) {
  write([...read().filter((x) => x.ticketId !== t.ticketId), { ...t, savedAt: Date.now() }]);
}

export function removeTicket(ticketId: string) {
  write(read().filter((x) => x.ticketId !== ticketId));
}