// frontend/src/lib/salonInfo.ts
// Small helpers for the salon info card: opening hours in Hindi/English, a map link, a call link.
import type { Lang } from './i18n';

function parse(hhmm: string | null | undefined): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm?.trim() ?? '');
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59 ? { h, m } : null;
}

// "09:00" -> "सुबह 9:00" / "9:00 AM";  "21:30" -> "रात 9:30" / "9:30 PM"
export function formatTime(hhmm: string | null | undefined, lang: Lang): string | null {
  const t = parse(hhmm);
  if (!t) return null;
  const h12 = t.h % 12 || 12;
  const mm = String(t.m).padStart(2, '0');
  if (lang === 'en') return `${h12}:${mm} ${t.h < 12 ? 'AM' : 'PM'}`;
  const part = t.h < 4 ? 'रात' : t.h < 12 ? 'सुबह' : t.h < 16 ? 'दोपहर' : t.h < 19 ? 'शाम' : 'रात';
  return `${part} ${h12}:${mm}`;
}

// Both times, or nothing (a half-known window is more confusing than none).
export function formatHours(open: string | null | undefined, close: string | null | undefined, lang: Lang): string | null {
  const a = formatTime(open, lang);
  const b = formatTime(close, lang);
  return a && b ? `${a} – ${b}` : null;
}

// Google Maps opens the Maps app on Android and the website elsewhere.
// The saved location is exact; the address is the fallback for salons without one.
export function mapsHref(info: {
  name: string;
  address?: string | null;
  location?: { lat: number; lng: number } | null;
}): string | null {
  const base = 'https://www.google.com/maps/search/?api=1&query=';
  if (info.location) return `${base}${info.location.lat},${info.location.lng}`;
  if (info.address) return base + encodeURIComponent(`${info.name}, ${info.address}`);
  return null;
}

// tel: link for the salon's number (+91 added to a plain 10-digit mobile).
export function callHref(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/[^\d+]/g, '');
  if (!/^\+?\d{7,15}$/.test(d)) return null;
  return /^\d{10}$/.test(d) ? `tel:+91${d}` : `tel:${d}`;
}

export const formatRupees = (p: number) => `₹${p.toLocaleString('en-IN')}`;
