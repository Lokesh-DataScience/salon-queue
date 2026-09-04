import { Router } from 'express';
import { supabase } from '../config/supabase';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  let dbStatus: 'connected' | 'unavailable' = 'unavailable';

  // Lightweight connectivity check: count rows in `salons` without
  // fetching any. Works even on an empty (freshly-seeded) table.
  const { error } = await supabase.from('salons').select('id', { count: 'exact', head: true });
  dbStatus = error ? 'unavailable' : 'connected';

  res.status(200).json({
    status: 'ok',
    db: dbStatus,
    timestamp: new Date().toISOString(),
  });
});