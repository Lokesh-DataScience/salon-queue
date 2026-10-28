// backend/src/routes/ticket.routes.ts
import { Router } from 'express';
import { getTicket, postLeaveTicket, putPushSubscription, deletePushSubscription } from '../controllers/queue.controller';

const router = Router();
router.get('/:ticketId', getTicket);
router.post('/:ticketId/leave', postLeaveTicket);

router.put('/:ticketId/push-subscription', putPushSubscription);
router.delete('/:ticketId/push-subscription', deletePushSubscription);

export default router;