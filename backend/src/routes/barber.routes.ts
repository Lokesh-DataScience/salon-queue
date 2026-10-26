// backend/src/routes/barber.routes.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  getQueue,
  postNext,
  postStart,
  postComplete,
  postSkip,
  postPause,
  postResume,
} from '../controllers/barber.controller';
import { getBarberSalon } from '../controllers/barberSalon.controller';

const router = Router();

router.use(requireAuth); // every route below requires a logged-in barber

router.get('/salon', getBarberSalon);
router.get('/queue', getQueue);
router.post('/queue/next', postNext);
router.post('/queue/:entryId/start', postStart);
router.post('/queue/:entryId/complete', postComplete);
router.post('/queue/:entryId/skip', postSkip);
router.post('/queue/pause', postPause);
router.post('/queue/resume', postResume);

export default router;
