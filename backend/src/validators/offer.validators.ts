// backend/src/validators/offer.validators.ts
import { z } from 'zod';

export const offerBodySchema = z.object({
  name: z.string().trim().min(2, 'Give the offer a name').max(40),
  dailyCount: z.number().int().min(1).max(50),
});

export const offerPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(40).optional(),
    dailyCount: z.number().int().min(1).max(50).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export const offerIdParamSchema = z.object({ offerId: z.string().uuid() });

export const redeemBodySchema = z.object({
  code: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{6}$/, 'Enter the 6-character code.')),
});