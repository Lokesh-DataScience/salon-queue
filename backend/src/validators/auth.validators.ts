// backend/src/validators/auth.validators.ts
import { z } from 'zod';

export const barberLoginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required.'),
});

export type BarberLoginBody = z.infer<typeof barberLoginBodySchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 09:00');

export const registerSalonBodySchema = z
  .object({
    salonName: z.string().trim().min(2, 'Enter your salon name').max(80),
    phone: z
      .string()
      .trim()
      .transform((s) => s.replace(/[\s\-().]/g, ''))
      .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, 'Enter a valid mobile number')),
    address: z.string().trim().min(5, 'Enter the full address').max(200),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    ownerName: z.string().trim().min(1, 'Enter your name').max(80),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    // bcrypt silently ignores everything past 72 bytes, so cap it.
    password: z.string().min(10, 'Use at least 10 characters').max(72),
    openingTime: hhmm.default('09:00'),
    closingTime: hhmm.default('21:00'),
    averageServiceMinutes: z.number().int().min(1).max(240).default(15),
  })
  .refine((v) => v.openingTime < v.closingTime, {
    path: ['closingTime'],
    message: 'Closing time must be after opening time',
  });

export type RegisterSalonBody = z.infer<typeof registerSalonBodySchema>;