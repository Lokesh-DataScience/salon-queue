// backend/src/validators/auth.validators.ts
import { z } from 'zod';

export const barberLoginBodySchema = z.object({
  email: z.string().email('A valid email is required.'),
  password: z.string().min(1, 'Password is required.'),
});

export type BarberLoginBody = z.infer<typeof barberLoginBodySchema>;