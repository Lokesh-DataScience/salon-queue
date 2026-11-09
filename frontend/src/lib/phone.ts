// frontend/src/lib/phone.ts
// Same rule as the server (backend/src/validators/queue.validators.ts): an Indian mobile is 10 digits
// starting 6-9, and "98765 43210", "+91 98765-43210" and "09876543210" are all the same number.
export function normalizeIndianMobile(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? d : null;
}