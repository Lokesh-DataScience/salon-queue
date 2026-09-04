// backend/src/routes/barber.routes.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

// Temporary stub — real queue logic lands in Milestone 3b.
// Its only job right now is to prove requireAuth actually blocks
// unauthenticated requests and passes through authenticated ones.
router.get('/queue', requireAuth, (req, res) => {
  res.json({ staff: req.staff, entries: [] });
});

export default router;