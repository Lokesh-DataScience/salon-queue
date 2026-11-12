// backend/src/middleware/admin.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { getAdminRole, type AdminRole } from '../services/admin.service';

// Always placed AFTER requireAuth.
//   requireAdminRole()          -> any admin role
//   requireAdminRole('SALES')   -> SALES (FOUNDER always passes)
// Anyone else gets 404, so the admin area looks like it doesn't exist.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireAdminRole(...allowed: AdminRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const staffId = req.staff?.staffId;
      if (typeof staffId !== 'string' || !UUID.test(staffId)) {
        return next(new AppError('Not authenticated.', 401));
      }

      const role = await getAdminRole(staffId);
      const permitted = role === 'FOUNDER' || (role !== null && (allowed.length === 0 || allowed.includes(role)));
      if (!permitted) return next(new AppError('Not found.', 404));

      res.locals.adminRole = role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// The role checked by requireAdminRole for this request.
export function adminRoleOf(res: Response): AdminRole {
  return res.locals.adminRole as AdminRole;
}
