// backend/src/routes/salon.routes.ts
import { Router } from 'express';
import { getNearbySalons, getPublicServices, getSalonByCode, getSalonDetails, getSalonLanes, getSalonQueue } from '../controllers/salon.controller';

import { blockSuspendedSalonByCode } from '../middleware/suspended.middleware';

const router = Router();
router.get('/nearby', getNearbySalons);
router.get('/by-code/:code', blockSuspendedSalonByCode, getSalonByCode); // must stay above '/:salonId'
router.get('/:salonId', getSalonDetails);
router.get('/:salonId/queue', getSalonQueue);
router.get('/:salonId/services', getPublicServices);
router.get('/:salonId/lanes', getSalonLanes);

export default router;
