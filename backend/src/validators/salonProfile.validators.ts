// backend/src/validators/salonProfile.validators.ts
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 09:00');

// 0 = Sunday ... 6 = Saturday. Whole numbers only, never "2".
const weekday = z.number().int().min(0).max(6);

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
    // Settings switch: "Allow joining from app". A real boolean only, never "true"/1.
    allowAppJoin: z.boolean(),
    // Settings: "Weekly off day". [] = open every day. Stored sorted, without repeats.
    weeklyOffDays: z
      .array(weekday)
      .max(7)
      .refine((d) => new Set(d).size < 7, 'Keep at least one day open')
      .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
  })
  .strict()
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export type UpdateSalonProfileBody = z.infer<typeof updateSalonProfileBodySchema>;