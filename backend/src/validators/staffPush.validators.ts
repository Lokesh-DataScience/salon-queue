// backend/src/validators/staffPush.validators.ts
// Barber "New token" alerts. Same push-service allowlist as customer tickets (no SSRF).
import { z } from 'zod';
import { pushSubscriptionSchema } from './queue.validators';

export const staffPushBodySchema = z.object({
  subscription: pushSubscriptionSchema,
});

// Endpoint in the BODY, never the URL: it is an identifier and must stay out of logs.
export const staffPushDeleteSchema = z.object({
  endpoint: z.string().min(1).max(2048),
});
