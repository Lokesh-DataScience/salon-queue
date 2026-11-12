// backend/src/middleware/suspended.middleware.ts
// A scan of a suspended salon's wall QR stops at the first step with a clear message,
// before the customer is asked for anything.
import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';
import { AppError } from './errorHandler';
import { SALON_SUSPENDED_PUBLIC } from '../utils/suspension';

export async function blockSuspendedSalonByCode(req: Request, _res: Response, next: NextFunction) {
  const code = String(req.params.code ?? '');
  if (!/^[A-Za-z0-9]{4,64}$/.test(code)) return next(); // let the normal handler answer odd codes

  try {
    const { data, error } = await supabase.from('salons').select('is_suspended').eq('qr_code', code).maybeSingle();
    if (error) return next(); // never block a scan because this check had a problem
    if (data?.is_suspended) return next(new AppError(SALON_SUSPENDED_PUBLIC, 409));
    next();
  } catch {
    next();
  }
}
