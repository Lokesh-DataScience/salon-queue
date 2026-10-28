// backend/src/validators/salon.validators.ts
import { z } from 'zod';

export const nearbySalonsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(50).optional().default(5),
});

export const salonIdParamSchema = z.object({
  salonId: z.string().uuid(),
});

// The short code printed in a salon's wall QR. Letters and digits only, so nothing odd reaches the query.
export const salonCodeParamSchema = z.object({
  code: z.string().regex(/^[a-zA-Z0-9]{8,32}$/),
});
