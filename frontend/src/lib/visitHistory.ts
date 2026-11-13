// frontend/src/lib/visitHistory.ts
// "इतिहास": this phone's last 50 finished visits. Only salon details, the token number, the outcome
// and the time. Never a name, phone number or ticket access token.
const KEY = 'svq.history.v1';
export const MAX_VISITS = 50;
const CODE = /^[a-z0-9]{8,32}$/;

export type VisitOutcome = 'COMPLETED' | 'SKIPPED' | 'CANCELLED';
const OUTCOMES: VisitOutcome[] = ['COMPLETED', 'SKIPPED', 'CANCELLED'];

export interface Visit {
  ticketId: string; // only to avoid recording the same visit twice
  salonId: string;
  salonName: string;
  salonCode?: string; // to open the salon again; missing for very old tickets
  tokenNumber: number;
  outcome: VisitOutcome;
  at: number; // when we noticed it finished
}

function isVisit(x: unknown): x is Visit {
  const v = x as Partial<Visit> | null;
  return (
    !!v &&
    typeof v.ticketId === 'string' &&
    typeof v.salonId === 'string' &&
    typeof v.salonName === 'string' &&
    (v.salonCode === undefined || (typeof v.salonCode === 'string' && CODE.test(v.salonCode))) &&
    typeof v.tokenNumber === 'number' &&
    OUTCOMES.includes(v.outcome as VisitOutcome) &&
    typeof v.at === 'number'
  );
}

// Every storage call is wrapped: private mode, blocked storage or a corrupt value
// must degrade to "no history", never crash the page.
function read(): Visit[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isVisit) : [];
  } catch {
    return [];
  }
}

function write(list: Visit[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_VISITS)));
  } catch {
    /* storage unavailable: history just isn't kept on this browser */
  }
}

// Newest first.
export function getVisits(): Visit[] {
  return read().sort((a, b) => b.at - a.at);
}

// Records a finished ticket once. Unknown statuses (still active) are ignored.
export function recordVisit(v: {
  ticketId: string;
  salonId: string;
  salonName?: string | null;
  salonCode?: string | null;
  tokenNumber: number;
  status: string;
}) {
  if (!OUTCOMES.includes(v.status as VisitOutcome) || !v.ticketId || !v.salonId) return;
  const all = read();
  if (all.some((x) => x.ticketId === v.ticketId)) return;
  const code = v.salonCode?.toLowerCase();
  const visit: Visit = {
    ticketId: v.ticketId,
    salonId: v.salonId,
    salonName: (v.salonName ?? '').slice(0, 80),
    ...(code && CODE.test(code) ? { salonCode: code } : {}),
    tokenNumber: v.tokenNumber,
    outcome: v.status as VisitOutcome,
    at: Date.now(),
  };
  write([visit, ...all.sort((a, b) => b.at - a.at)]);
}

export function clearVisits() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
