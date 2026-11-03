// backend/src/validators/salonServices.validators.ts
import { z } from 'zod';

const serviceName = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Each service name needs at least 2 characters')
      .max(30, 'Keep each service name under 30 characters')
      .regex(/^[\p{L}\p{M}\p{N} &'.,()+\-]+$/u, 'Service names can only use letters, numbers and basic punctuation'),
  );

// .strict() rejects any extra key (salonId etc.).
export const addServiceBodySchema = z.object({ name: serviceName }).strict();

export const serviceIdParamSchema = z.object({ serviceId: z.string().uuid('Invalid service.') });