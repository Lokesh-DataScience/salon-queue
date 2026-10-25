// backend/src/controllers/queue.controller.ts
import { Request, Response, NextFunction } from 'express';
import { salonIdParamSchema } from '../validators/salon.validators';
import { ticketParamSchema, ticketAccessQuerySchema } from '../validators/queue.validators';
import { joinQueue, getTicketStatus, broadcastQueueUpdate, QueueJoinError, leaveTicket } from '../services/queue.service';
import { pushSubscriptionBodySchema } from '../validators/queue.validators';
import { savePushSubscription, removePushSubscription } from '../services/queue.service';

export async function postJoinQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = salonIdParamSchema.parse(req.params);
    const ticket = await joinQueue(salonId);
    await broadcastQueueUpdate(salonId, { silentEntryId: ticket.ticketId });
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
    const { accessToken } = ticketAccessQuerySchema.parse({accessToken: req.get('x-ticket-token') ?? req.query.accessToken,});
    const status = await getTicketStatus(ticketId, accessToken);
    if (!status) return res.status(404).json({ message: 'Ticket not found or access denied.' });
    res.json({ ticket: status });
  } catch (err) {
    next(err);
  }
}

export async function postLeaveTicket(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = ticketParamSchema.parse(req.params);
    // Token goes in the body (not the URL) so it stays out of logs and history.
    const { accessToken } = ticketAccessQuerySchema.parse(req.body);
    const result = await leaveTicket(ticketId, accessToken);
    if (!result) return res.status(404).json({ message: 'Ticket not found or access denied.' });
    await broadcastQueueUpdate(result.salonId);
    res.json({ ticket: { ticketId, status: 'CANCELLED' } });
  } catch (err) {
    next(err);
  }
}

export async function putPushSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = ticketParamSchema.parse(req.params);
    const { accessToken, subscription } = pushSubscriptionBodySchema.parse(req.body);
    const ok = await savePushSubscription(ticketId, accessToken, subscription);
    if (!ok) return res.status(404).json({ message: 'Ticket not found or access denied.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function deletePushSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = ticketParamSchema.parse(req.params);
    const { accessToken } = ticketAccessQuerySchema.parse(req.body);
    const ok = await removePushSubscription(ticketId, accessToken);
    if (!ok) return res.status(404).json({ message: 'Ticket not found or access denied.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}