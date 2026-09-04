// backend/src/controllers/queue.controller.ts
import { Request, Response, NextFunction } from 'express';
import { salonIdParamSchema } from '../validators/salon.validators';
import { joinQueueBodySchema, ticketParamSchema, ticketAccessQuerySchema } from '../validators/queue.validators';
import { joinQueue, getTicketStatus, QueueJoinError } from '../services/queue.service';

export async function postJoinQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = salonIdParamSchema.parse(req.params);
    const { name, phone } = joinQueueBodySchema.parse(req.body);
    const ticket = await joinQueue(salonId, name, phone);
    res.status(201).json({ ticket });
  } catch (err) {
    if (err instanceof QueueJoinError) {
      return res.status(409).json({ message: err.message });
    }
    next(err);
  }
}

export async function getTicket(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = ticketParamSchema.parse(req.params);
    const { accessToken } = ticketAccessQuerySchema.parse(req.query);
    const status = await getTicketStatus(ticketId, accessToken);
    if (!status) return res.status(404).json({ message: 'Ticket not found or access denied.' });
    res.json({ ticket: status });
  } catch (err) {
    next(err);
  }
}