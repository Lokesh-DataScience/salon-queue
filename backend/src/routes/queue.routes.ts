// backend/src/routes/queue.routes.ts
import { Router } from 'express';
import { postJoinQueue } from '../controllers/queue.controller';

const router = Router();
router.post('/:salonId/join', postJoinQueue);

export default router;