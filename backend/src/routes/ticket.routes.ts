// backend/src/routes/ticket.routes.ts
import { Router } from 'express';
import { getTicket, postLeaveTicket, putPushSubscription, deletePushSubscription, postForgetMe, postTestPush } from '../controllers/queue.controller';

const router = Router();
router.get('/:ticketId', getTicket);
router.post('/:ticketId/leave', postLeaveTicket);
router.post('/:ticketId/forget-me', postForgetMe);

router.put('/:ticketId/push-subscription', putPushSubscription);
router.delete('/:ticketId/push-subscription', deletePushSubscription);
router.post('/:ticketId/test-push', postTestPush); // customer app: check alerts reach this phone

export default router;