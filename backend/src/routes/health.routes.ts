// backend/src/routes/health.routes.ts
import { Router } from 'express';
import { supabase } from '../config/supabase';
import { recordSuccess } from '../services/heartbeat.service';

// Only the uptime pinger counts, so opening the Health page yourself doesn't look like a ping.
const PINGER_UA = /cron-job\.org|uptimerobot/i;

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  if (PINGER_UA.test(req.get('user-agent') ?? '')) void recordSuccess('pinger');

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
