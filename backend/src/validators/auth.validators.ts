// backend/src/validators/auth.validators.ts
import { z } from 'zod';

export const barberLoginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required.'),
});

export type BarberLoginBody = z.infer<typeof barberLoginBodySchema>;