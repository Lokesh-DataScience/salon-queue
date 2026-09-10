// backend/src/validators/barber.validators.ts
import { z } from 'zod';

export const entryIdParamSchema = z.object({
  entryId: z.string().uuid('Invalid entry id.'),
});