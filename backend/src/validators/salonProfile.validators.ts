// backend/src/validators/salonProfile.validators.ts
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 09:00');

// .strict() rejects any key not listed here (salonId, is_open, qr_code...), so a
// tampered request cannot change anything beyond the profile fields.
export const updateSalonProfileBodySchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your salon name').max(80),
    phone: z
      .string()
      .trim()
      .transform((s) => s.replace(/[\s\-().]/g, ''))
      .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, 'Enter a valid mobile number')),
    address: z.string().trim().min(5, 'Enter the full address').max(200),
    openingTime: hhmm,
    closingTime: hhmm,
    averageServiceMinutes: z.number().int().min(1).max(240),
  })
  .strict()
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export type UpdateSalonProfileBody = z.infer<typeof updateSalonProfileBodySchema>;