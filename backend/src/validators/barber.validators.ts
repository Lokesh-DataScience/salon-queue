// backend/src/validators/barber.validators.ts
import { z } from 'zod';
import { normalizePhone } from '../utils/phone';

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

// ── Team (owner only) ──────────────────────────────────────────────────────
export const staffIdParamSchema = z.object({
  staffId: z.string().uuid('Invalid staff id.'),
});

const staffName = z
  .string({ error: (issue) => (issue.input === undefined ? 'Enter their name.' : 'Name must be text.') })
  .trim()
  .min(1, 'Enter their name.')
  .max(60, 'Name can be at most 60 characters.');

const staffPhone = z
  .string({ error: (issue) => (issue.input === undefined ? 'Enter their phone number.' : 'Phone must be text.') })
  .trim()
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number.' });
      return z.NEVER;
    }
    return phone;
  });

// bcrypt silently ignores everything past 72 bytes, so cap it.
const staffPassword = z
  .string({ error: (issue) => (issue.input === undefined ? 'Enter a password.' : 'Password must be text.') })
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use at most 72 characters.');

export const addStaffSchema = z
  .object({ name: staffName, phone: staffPhone, password: staffPassword })
  .strict();

export const resetStaffPasswordSchema = z.object({ password: staffPassword }).strict();

export const setStaffActiveSchema = z.object({ isActive: z.boolean() }).strict();

// ── Lines (Slice I) ────────────────────────────────────────────────────────
// Only the owner can pick a line other than their own; for staff this is ignored.
export const laneQuerySchema = z.object({
  laneId: z.string().uuid('Invalid line id.').optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: (issue) => (issue.input === undefined ? 'Enter your current password.' : 'Password must be text.') })
      .min(1, 'Enter your current password.')
      .max(200),
    newPassword: staffPassword,
  })
  .strict();
