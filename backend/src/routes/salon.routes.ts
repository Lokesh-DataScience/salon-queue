// backend/src/routes/salon.routes.ts
import { Router } from 'express';
import { getNearbySalons, getPublicServices, getSalonByCode, getSalonDetails, getSalonQueue } from '../controllers/salon.controller';

const router = Router();
router.get('/nearby', getNearbySalons);
router.get('/by-code/:code', getSalonByCode); // must stay above '/:salonId'
router.get('/:salonId', getSalonDetails);
router.get('/:salonId/queue', getSalonQueue);
router.get('/:salonId/services', getPublicServices);

export default router;
