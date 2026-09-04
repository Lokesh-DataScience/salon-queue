// backend/src/routes/ticket.routes.ts
import { Router } from 'express';
import { getTicket } from '../controllers/queue.controller';

const router = Router();
router.get('/:ticketId', getTicket);

export default router;