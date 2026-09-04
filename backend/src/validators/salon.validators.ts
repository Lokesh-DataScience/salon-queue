import { z } from 'zod';

export const nearbySalonsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(50).optional().default(5),
});

export const salonIdParamSchema = z.object({
  salonId: z.string().uuid(),
});