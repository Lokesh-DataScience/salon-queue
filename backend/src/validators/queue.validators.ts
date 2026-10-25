// backend/src/validators/queue.validators.ts
import { z } from 'zod';

// const phoneSchema = z
//   .string()
//   .trim()
//   .transform((s) => s.replace(/[\s\-().]/g, '')) // accept "98765 43210", "+91 98765-43210", "(+91) ..."
//   .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, 'Enter a valid mobile number'));

export const joinQueueBodySchema = z.object({});
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