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
  postWalkIn,
} from '../controllers/barber.controller';
import { getOffers, postOffer, patchOffer, removeOffer, postRedeem, patchExpected } from '../controllers/offers.controller';
import { getProfile, patchProfile } from '../controllers/salonProfile.controller';
import { getStats } from '../controllers/barberStats.controller';
import { getServices, postService, patchService, removeService } from '../controllers/salonServices.controller';

const router = Router();

router.use(requireAuth); // every route below requires a logged-in barber

router.get('/salon', getProfile);
router.patch('/salon', patchProfile);
router.get('/stats', getStats); // after router.patch('/salon', patchProfile)
router.get('/services', getServices);
router.post('/services', postService);
router.patch('/services/:serviceId', patchService);
router.delete('/services/:serviceId', removeService);
router.get('/queue', getQueue);
router.post('/queue/next', postNext);
router.post('/queue/:entryId/start', postStart);
router.post('/queue/:entryId/complete', postComplete);
router.post('/queue/:entryId/skip', postSkip);
router.post('/queue/pause', postPause);
router.post('/queue/resume', postResume);
router.post('/queue/walk-in', postWalkIn);
router.get('/offers', getOffers);
router.post('/offers', postOffer);
router.post('/offers/redeem', postRedeem);
router.patch('/offers/expected', patchExpected);
router.patch('/offers/:offerId', patchOffer);
router.delete('/offers/:offerId', removeOffer);
export default router;
