// backend/src/controllers/queue.controller.ts
import { Request, Response, NextFunction } from 'express';
import { salonIdParamSchema } from '../validators/salon.validators';
import { ticketParamSchema, ticketAccessQuerySchema } from '../validators/queue.validators';
import { joinQueue, getTicketStatus, broadcastQueueUpdate, QueueJoinError, leaveTicket } from '../services/queue.service';
import { pushSubscriptionBodySchema, joinQueueBodySchema } from '../validators/queue.validators';
import { savePushSubscription, removePushSubscription, forgetMyDetails } from '../services/queue.service';
import { advanceSalonQueue } from '../services/queueAutomation.service';
import { SALON_SUSPENDED_PUBLIC, isSalonSuspendedError } from '../utils/suspension';
import { sendTestPush } from '../services/testPush.service';

// Missing details / consent are the customer's to fix: 400 plus a code the join page can react to.
const CUSTOMER_INPUT_CODES = ['CUSTOMER_DETAILS_REQUIRED', 'CONSENT_REQUIRED'];

export async function postJoinQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const { salonId } = salonIdParamSchema.parse(req.params);
    const { clientKey, serviceIds, laneId, name, phone, consent, rememberToken, source } =
      joinQueueBodySchema.parse(req.body ?? {});
    const ticket = await joinQueue(salonId, clientKey, serviceIds, laneId, {
      name,
      phone,
      consent,
      rememberToken,
      source,
    });

    // An existing ticket handed back: nothing in the queue changed, so nothing to start or broadcast.
    if (!ticket.existing) {
      // First customer in an empty queue starts now. A failure here must never lose the
      // customer's ticket: the sweeper picks the queue up within about 10 seconds anyway.
      await advanceSalonQueue(salonId).catch(() => {
        console.error(`[queue] auto-start failed salon=${salonId}`);
      });

      await broadcastQueueUpdate(salonId, { silentEntryId: ticket.ticketId });
    }
    res.status(201).json({ ticket });
  } catch (err) {
    // Admin Slice 2: the founder suspended this salon (raised by the queue_entries trigger).
    if (isSalonSuspendedError(err)) {
      return res.status(409).json({ message: SALON_SUSPENDED_PUBLIC, code: 'SALON_SUSPENDED' });
    }
    if (err instanceof QueueJoinError) {
      if (CUSTOMER_INPUT_CODES.includes(err.code)) {
        return res.status(400).json({ message: err.message, code: err.code });
      }
      // The barber switched app joins off: the customer can still scan the wall QR.
      if (err.code === 'APP_JOIN_DISABLED') {
        return res.status(403).json({ message: err.message, code: err.code });
      }
      // code lets the app show its own (Hindi) text; older pages just show the message.
      return res.status(409).json({ message: err.message, code: err.code });
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

// Customer app polish 3a: "Send a test notification" from the ticket page.
const TEST_PUSH_ERRORS = {
  PUSH_DISABLED: { status: 409, message: 'Notifications are not available right now.' },
  NO_SUBSCRIPTION: { status: 409, message: 'Notifications are not turned on for this ticket.' },
  TOO_SOON: { status: 429, message: 'Please wait a little before sending another test.' },
  EXPIRED: { status: 410, message: 'This phone stopped accepting notifications. Please turn them on again.' },
  FAILED: { status: 502, message: 'The test could not be sent. Please try again.' },
} as const;

export async function postTestPush(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = ticketParamSchema.parse(req.params);
    // Token in the body (not the URL) so it stays out of logs and history.
    const { accessToken } = ticketAccessQuerySchema.parse({ accessToken: req.body?.accessToken });
    const lang = req.body?.lang === 'en' ? 'en' : 'hi';
    const result = await sendTestPush(ticketId, accessToken, lang);
    if (result.ok) return res.json({ ok: true });
    if (result.reason === 'NOT_FOUND') return res.status(404).json({ message: 'Ticket not found or access denied.' });
    const e = TEST_PUSH_ERRORS[result.reason];
    res.status(e.status).json({ message: e.message, code: result.reason });
  } catch (err) {
    next(err);
  }
}
