// frontend/src/lib/phoneLink.ts
// Customer and salon numbers are stored as 10 digits. These turn them into what a barber taps and reads.

const digitsOf = (phone: string) => phone.replace(/[^\d+]/g, '');

// tel: link that dials from anywhere (+91 added for a 10-digit mobile).
export function telHref(phone: string): string {
  const d = digitsOf(phone);
  return /^\d{10}$/.test(d) ? `tel:+91${d}` : `tel:${d}`;
}

// 9876543210 -> "98765 43210" (anything else is shown as it is).
export function formatPhone(phone: string): string {
  const d = phone.replace(/\s+/g, '');
  return /^\d{10}$/.test(d) ? `${d.slice(0, 5)} ${d.slice(5)}` : phone;
}

// For printing and reading aloud: "+919876543210" and "9876543210" both become a grouped number.
// +91 is kept when the stored number has it, anything unusual is shown as it was typed.
export function displayPhone(phone: string): string {
  const d = phone.replace(/[\s-]/g, '');
  const m = d.match(/^(\+91|91)?(\d{10})$/);
  if (!m) return phone.trim();
  const grouped = `${m[2].slice(0, 5)} ${m[2].slice(5)}`;
  return m[1] === '+91' || m[1] === '91' ? `+91 ${grouped}` : grouped;
}