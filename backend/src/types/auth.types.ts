// backend/src/types/auth.types.ts
import type { z } from 'zod';

export type StaffRole = 'OWNER' | 'BARBER' | 'MANAGER';

export interface JwtPayload {
  staffId: string;
  salonId: string;
  role: StaffRole;
}

// Augment Express's Request type so `req.staff` is typed everywhere
// without needing `as` casts in every controller.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: JwtPayload;
    }
  }
}