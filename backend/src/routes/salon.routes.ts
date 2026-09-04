import { Router } from 'express';
import { getNearbySalons, getSalonDetails, getSalonQueue } from '../controllers/salon.controller';

const router = Router();
router.get('/nearby', getNearbySalons);
router.get('/:salonId', getSalonDetails);
router.get('/:salonId/queue', getSalonQueue);

export default router;