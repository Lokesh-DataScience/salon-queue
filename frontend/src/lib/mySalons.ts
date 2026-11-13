// frontend/src/lib/mySalons.ts
// The salons this phone has scanned, for the customer app's "My salons" list.
// Only what is printed on the salon's own QR poster: id, QR code and name, plus this phone's own
// "pinned" choice. Never anything about the customer.
const KEY = 'svq.mysalons.v1';
const MAX_SALONS = 20;
const CODE = /^[a-z0-9]{8,32}$/;

export interface MySalon {
  salonId: string;
  code: string;
  name: string;
  lastVisitedAt: number;
  pinned?: boolean; // pinned salons stay at the top
}

function isSalon(x: unknown): x is MySalon {
  const s = x as Partial<MySalon> | null;
  return (
    !!s &&
    typeof s.salonId === 'string' &&
    typeof s.code === 'string' &&
    CODE.test(s.code) &&
    typeof s.name === 'string' &&
    typeof s.lastVisitedAt === 'number' &&
    (s.pinned === undefined || typeof s.pinned === 'boolean')
  );
}

// Pinned first, then the most recently visited.
function ordered(list: MySalon[]): MySalon[] {
  return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.lastVisitedAt - a.lastVisitedAt);
}

// Every storage call is wrapped: private mode, blocked storage or a corrupt value
// must degrade to "no saved salons", never crash the page.
function read(): MySalon[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSalon) : [];
  } catch {
    return [];
  }
}

// When the list is full, the oldest unpinned salon is the one that drops off.
function write(list: MySalon[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ordered(list).slice(0, MAX_SALONS)));
  } catch {
    /* storage unavailable: the list just stays empty on this browser */
  }
}

export function getMySalons(): MySalon[] {
  return ordered(read());
}

export function saveMySalon(s: { salonId: string; code: string; name: string }) {
  const code = s.code.toLowerCase();
  if (!CODE.test(code) || !s.salonId) return;
  const all = read();
  const pinned = all.find((x) => x.salonId === s.salonId)?.pinned; // keep the customer's pin
  const rest = all.filter((x) => x.salonId !== s.salonId);
  write([
    { salonId: s.salonId, code, name: s.name.slice(0, 80), lastVisitedAt: Date.now(), ...(pinned ? { pinned: true } : {}) },
    ...rest,
  ]);
}

export function removeMySalon(salonId: string) {
  write(read().filter((x) => x.salonId !== salonId));
}

export function isSalonPinned(salonId: string): boolean {
  return read().some((x) => x.salonId === salonId && x.pinned === true);
}

export function setSalonPinned(salonId: string, pinned: boolean) {
  write(
    read().map((x) => {
      if (x.salonId !== salonId) return x;
      const { pinned: _old, ...rest } = x;
      return pinned ? { ...rest, pinned: true } : rest;
    }),
  );
}
