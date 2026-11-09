// backend/src/validators/queue.validators.ts
import { z } from 'zod';

// Indian mobile numbers, stored ONE way so "98765 43210", "+91 98765-43210" and "09876543210"
// are the same person at a salon: exactly 10 digits, starting 6-9.
export function normalizeIndianMobile(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? d : null;
}

const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .refine((s) => normalizeIndianMobile(s) !== null, 'Enter a valid 10-digit mobile number.')
  .transform((s) => normalizeIndianMobile(s) as string);

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter your name.')
  .max(80, 'Name is too long.')
  .transform((s) => s.replace(/\s+/g, ' '))
  .refine((s) => !/[\u0000-\u001F\u007F<>]/.test(s), 'Name contains characters that are not allowed.');

export const joinQueueBodySchema = z.object({
  clientKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Invalid request key.').optional(),
  serviceIds: z.array(z.string().uuid()).max(8).optional(),
  // A barber's line. Left out = "Any barber" (the server picks the shortest wait).
  laneId: z.string().uuid().optional(),
  // First time at this salon: name + phone + consent. Returning: just the salon's remember token.
  name: nameSchema.optional(),
  phone: phoneSchema.optional(),
  consent: z.boolean().optional(),
  rememberToken: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid token.').optional(),
});

export const ticketParamSchema = z.object({
  ticketId: z.string().uuid(),
});

export const ticketAccessQuerySchema = z.object({
  accessToken: z.string().min(32),
});

// The server will make an HTTP request to this URL later, so it must be a real push service,
// never an arbitrary address the client chose (SSRF).
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

function isAllowedPushEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
    return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedPushEndpoint, 'Unsupported push service'),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});

export const pushSubscriptionBodySchema = z.object({
  accessToken: z.string().min(32),
  subscription: pushSubscriptionSchema,
});