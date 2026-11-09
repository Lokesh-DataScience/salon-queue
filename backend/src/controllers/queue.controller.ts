// backend/src/controllers/queue.controller.ts
import { Request, Response, NextFunction } from 'express';
import { salonIdParamSchema } from '../validators/salon.validators';
import { ticketParamSchema, ticketAccessQuerySchema } from '../validators/queue.validators';
import { joinQueue, getTicketStatus, broadcastQueueUpdate, QueueJoinError, leaveTicket } from '../services/queue.service';
import { pushSubscriptionBodySchema, joinQueueBodySchema } from '../validators/queue.validators';
import { savePushSubscription, removePushSubscription, forgetMyDetails } from '../services/queue.service';
import { advanceSalonQueue } from '../services/queueAutomation.service';

// Missing details / consent are the customer's to fix: 400 plus a code the join page can react to.
const CUSTOMER_INPUT_CODES = ['CUSTOMER_DETAILS_REQUIRED', 'CONSENT_REQUIRED'];

export async function postJoinQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = salonIdParamSchema.parse(req.params);
    const { clientKey, serviceIds, laneId, name, phone, consent, rememberToken } = joinQueueBodySchema.parse(
      req.body ?? {},
    );
    const ticket = await joinQueue(salonId, clientKey, serviceIds, laneId, { name, phone, consent, rememberToken });

    // First customer in an empty queue starts now. A failure here must never lose the
    // customer's ticket: the sweeper picks the queue up within about 10 seconds anyway.
    await advanceSalonQueue(salonId).catch(() => {
      console.error(`[queue] auto-start failed salon=${salonId}`);
    });

    await broadcastQueueUpdate(salonId, { silentEntryId: ticket.ticketId });
    res.status(201).json({ ticket });
  } catch (err) {
    if (err instanceof QueueJoinError) {
      if (CUSTOMER_INPUT_CODES.includes(err.code)) {
        return res.status(400).json({ message: err.message, code: err.code });
      }
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

// "Remove my details from this salon": deletes the customer's row in THIS salon's list.
export async function postForgetMe(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = ticketParamSchema.parse(req.params);
    const { accessToken } = ticketAccessQuerySchema.parse(req.body);
    const salonId = await forgetMyDetails(ticketId, accessToken);
    if (!salonId) return res.status(404).json({ message: 'Ticket not found or access denied.' });
    res.json({ ok: true });
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