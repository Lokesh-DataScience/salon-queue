// backend/src/routes/ticket.routes.ts
import { Router } from 'express';
import { getTicketRating, postTicketRating } from '../controllers/ratings.controller';
import { getTicket, postLeaveTicket, putPushSubscription, deletePushSubscription, postForgetMe, postTestPush } from '../controllers/queue.controller';

const router = Router();
router.get('/:ticketId', getTicket);
router.post('/:ticketId/leave', postLeaveTicket);
router.post('/:ticketId/forget-me', postForgetMe);

router.put('/:ticketId/push-subscription', putPushSubscription);
router.delete('/:ticketId/push-subscription', deletePushSubscription);
router.post('/:ticketId/test-push', postTestPush); // customer app: check alerts reach this phone
router.get('/:ticketId/rating', getTicketRating); // customer app: 1–5 stars for a finished visit
router.post('/:ticketId/rating', postTicketRating);

export default router;