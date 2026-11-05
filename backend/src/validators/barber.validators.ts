// backend/src/validators/barber.validators.ts
import { z } from 'zod';

export const entryIdParamSchema = z.object({
  entryId: z.string().uuid('Invalid entry id.'),
});

export const serviceIdParamSchema = z.object({
  serviceId: z.string().uuid('Invalid service id.'),
});

const serviceName = z
  .string({
    error: (issue) =>
      issue.input === undefined ? 'Enter a service name.' : 'Service name must be text.',
  })
  .trim()
  .min(1, 'Enter a service name.')
  .max(60, 'Service name can be at most 60 characters.');

const serviceDuration = z
  .number({
    error: (issue) =>
      issue.input === undefined ? 'Enter the time in minutes.' : 'Time must be a number.',
  })
  .int('Time must be a whole number of minutes.')
  .min(1, 'Time must be at least 1 minute.')
  .max(240, 'Time can be at most 240 minutes.');
  
export const createServiceSchema = z
  .object({ name: serviceName, durationMinutes: serviceDuration })
  .strict();

export const updateServiceSchema = z
  .object({ name: serviceName.optional(), durationMinutes: serviceDuration.optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.durationMinutes !== undefined, {
    message: 'Nothing to update.',
  });

  export const extendBodySchema = z
  .object({ minutes: z.number().int().min(1).max(30).default(5) })
  .strict();