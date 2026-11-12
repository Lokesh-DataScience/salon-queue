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
