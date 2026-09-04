import { z } from 'zod';

export const joinQueueBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number'),
});

export const ticketParamSchema = z.object({
  ticketId: z.string().uuid(),
});

export const ticketAccessQuerySchema = z.object({
  accessToken: z.string().min(32),
});