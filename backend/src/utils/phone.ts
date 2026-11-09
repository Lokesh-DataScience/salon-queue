// backend/src/utils/phone.ts
// One canonical stored form for staff phone numbers: "+" and country code, digits only.
// Indian mobiles may be typed as 9876543210, 09876543210, 919876543210 or +91 98765 43210.
// Returns null when the input is not a usable number.
export function normalizePhone(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) return cleaned;
  const indian = cleaned.match(/^(?:91|0)?([6-9]\d{9})$/);
  return indian ? `+91${indian[1]}` : null;
}