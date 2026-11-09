// backend/src/routes/barber.routes.ts
import { Router } from 'express';
import { requireAuth, requireOwner } from '../middleware/auth.middleware';
import {
  getQueue,
  postNext,
  postStart,
  postComplete,
  postSkip,
  postPause,
  postResume,
  postWalkIn,
  postExtend,
  postPrioritize,
} from '../controllers/barber.controller';
import { getOffers, postOffer, patchOffer, removeOffer, postRedeem, patchExpected } from '../controllers/offers.controller';
import { getProfile, patchProfile } from '../controllers/salonProfile.controller';
import { getStats } from '../controllers/barberStats.controller';
import { getServices, postService, patchService, removeService } from '../controllers/salonServices.controller';
import {
  getMe,
  postChangePassword,
  getTeam,
  postTeamMember,
  postTeamMemberPassword,
  patchTeamMember,
} from '../controllers/team.controller';

const router = Router();

router.use(requireAuth); // every route below requires a logged-in staff member

router.get('/me', getMe);
router.post('/me/password', postChangePassword);

// ── Owner only: salon settings, services, stats, offers, team ──
router.get('/salon', requireOwner, getProfile);
router.patch('/salon', requireOwner, patchProfile);
router.get('/stats', requireOwner, getStats);
router.get('/services', requireOwner, getServices);
router.post('/services', requireOwner, postService);
router.patch('/services/:serviceId', requireOwner, patchService);
router.delete('/services/:serviceId', requireOwner, removeService);
router.get('/team', requireOwner, getTeam);
router.post('/team', requireOwner, postTeamMember);
router.post('/team/:staffId/password', requireOwner, postTeamMemberPassword);
router.patch('/team/:staffId', requireOwner, patchTeamMember);

// ── Any signed-in staff member: running the queue ──
router.get('/queue', getQueue);
router.post('/queue/next', postNext);
router.post('/queue/:entryId/start', postStart);
router.post('/queue/:entryId/complete', postComplete);
router.post('/queue/:entryId/extend', postExtend);
router.post('/queue/:entryId/skip', postSkip);
router.post('/queue/:entryId/prioritize', postPrioritize);
router.post('/queue/pause', postPause);
router.post('/queue/resume', postResume);
router.post('/queue/walk-in', postWalkIn);
// Redeeming a customer's prize code happens at the counter, so any staff member can do it.
router.post('/offers/redeem', postRedeem);
router.get('/offers', requireOwner, getOffers);
router.post('/offers', requireOwner, postOffer);
router.patch('/offers/expected', requireOwner, patchExpected);
router.patch('/offers/:offerId', requireOwner, patchOffer);
router.delete('/offers/:offerId', requireOwner, removeOffer);
export default router;
