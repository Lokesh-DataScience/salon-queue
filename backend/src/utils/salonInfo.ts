// backend/src/utils/salonInfo.ts
// The salon's own contact details for the customer app's info card (GET /api/salons/:id/queue-public).
// Business details only, never anything about customers. Empty values become null, and a 0,0
// location (never set) is left out so the app's map button falls back to the address.
export function publicSalonInfo(s: {
  address?: string | null;
  phone?: string | null;
  opening_time?: string | null;
  closing_time?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}) {
  const hhmm = (t?: string | null) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t?.trim() ?? '');
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
  };
  const lat = s.latitude == null ? NaN : Number(s.latitude);
  const lng = s.longitude == null ? NaN : Number(s.longitude);
  const hasLocation =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  return {
    address: s.address?.trim() || null,
    phone: s.phone?.trim() || null,
    openingTime: hhmm(s.opening_time),
    closingTime: hhmm(s.closing_time),
    location: hasLocation ? { lat, lng } : null,
  };
}
