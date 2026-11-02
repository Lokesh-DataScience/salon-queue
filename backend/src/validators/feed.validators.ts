// backend/src/validators/feed.validators.ts
import { z } from 'zod';

export const salonIdParamSchema = z.object({ salonId: z.string().uuid() });

export const reverseGeoQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});