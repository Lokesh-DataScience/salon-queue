// backend/src/routes/queue.routes.ts
import { Router } from 'express';
import { postJoinQueue, getPublicServices } from '../controllers/queue.controller';

const router = Router();
router.get('/:salonId/services', getPublicServices);
router.post('/:salonId/join', postJoinQueue);

export default router;