// frontend/src/lib/mySalons.ts
// The salons this phone has scanned, for the customer app's "My salons" list.
// Only what is printed on the salon's own QR poster: id, QR code and name. Never anything about the customer.
const KEY = 'svq.mysalons.v1';
const MAX_SALONS = 20;
const CODE = /^[a-z0-9]{8,32}$/;

export interface MySalon {
  salonId: string;
  code: string;
  name: string;
  lastVisitedAt: number;
}

function isSalon(x: unknown): x is MySalon {
  const s = x as Partial<MySalon> | null;
  return (
    !!s &&
    typeof s.salonId === 'string' &&
    typeof s.code === 'string' &&
    CODE.test(s.code) &&
    typeof s.name === 'string' &&
    typeof s.lastVisitedAt === 'number'
  );
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

function write(list: MySalon[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SALONS)));
  } catch {
    /* storage unavailable: the list just stays empty on this browser */
  }
}

// Newest first.
export function getMySalons(): MySalon[] {
  return read().sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
}

export function saveMySalon(s: { salonId: string; code: string; name: string }) {
  const code = s.code.toLowerCase();
  if (!CODE.test(code) || !s.salonId) return;
  const rest = read().filter((x) => x.salonId !== s.salonId);
  write([{ salonId: s.salonId, code, name: s.name.slice(0, 80), lastVisitedAt: Date.now() }, ...rest]);
}

export function removeMySalon(salonId: string) {
  write(read().filter((x) => x.salonId !== salonId));
}
