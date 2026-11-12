// backend/src/validators/admin.validators.ts
import { z } from 'zod';

export const adminSalonIdParamSchema = z.object({ salonId: z.string().uuid() });
export const adminStaffIdParamSchema = z.object({ staffId: z.string().uuid() });

export const adminSalonListQuerySchema = z.object({
  search: z.string().trim().max(50).optional(),
});

export const suspendBodySchema = z.object({ suspended: z.boolean() }).strict();
export const internalBodySchema = z.object({ isInternal: z.boolean() }).strict();

export const adminResetPasswordBodySchema = z
  .object({
    founderPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8, 'Use at least 8 characters.').max(200),
  })
  .strict();

export const deleteSalonBodySchema = z.object({ confirmName: z.string().trim().min(1).max(200) }).strict();

// Slice 4: Sales partner flag + notes. At least one of the two.
export const salesInfoBodySchema = z
  .object({
    isPartner: z.boolean().optional(),
    notes: z.string().max(2000, 'Notes can be at most 2000 characters.').optional(),
  })
  .strict()
  .refine((b) => b.isPartner !== undefined || b.notes !== undefined, { message: 'Nothing to update.' });

// Slice 3: team (admin roles) and audit log. FOUNDER is never granted from the app.
export const grantAdminBodySchema = z
  .object({
    identifier: z.string().trim().min(3).max(200), // the account's email or phone
    role: z.enum(['SALES', 'TECH']),
    markSalonInternal: z.boolean().default(true),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export const auditQuerySchema = z.object({
  group: z.enum(['salon', 'staff', 'sales', 'admin']).optional(),
  before: z.coerce.number().int().positive().optional(), // id cursor for "Load more"
});

// Slice 5: onboarding period
export const onboardingQuerySchema = z.object({ period: z.enum(['30', '90', 'all']).default('30') });

// Slice 6: leads
export const LEAD_STATUSES = ['new', 'contacted', 'demo', 'interested', 'not_interested', 'converted'] as const;

const leadFields = {
  name: z.string().trim().min(1, 'Enter the salon name.').max(120),
  ownerName: z.string().trim().max(120),
  phone: z.string().trim().max(20),
  area: z.string().trim().max(120),
  address: z.string().trim().max(300),
  status: z.enum(LEAD_STATUSES),
  followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-20.').nullable(),
  notes: z.string().max(2000, 'Notes can be at most 2000 characters.'),
  salonId: z.string().uuid().nullable(),
};

export const createLeadBodySchema = z
  .object({ ...leadFields })
  .partial()
  .required({ name: true })
  .strict();

export const updateLeadBodySchema = z
  .object({ ...leadFields })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });

export const leadIdParamSchema = z.object({ leadId: z.string().uuid() });

// Slice 9: Tech salon lookup
export const techSalonSearchSchema = z.object({ search: z.string().trim().max(50).optional() });
