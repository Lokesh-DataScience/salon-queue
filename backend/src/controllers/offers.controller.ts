// backend/src/controllers/offers.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import {
  offerBodySchema,
  offerPatchSchema,
  offerIdParamSchema,
  redeemBodySchema,
} from '../validators/offer.validators';
import { listOffers, createOffer, updateOffer, deleteOffer, redeemPrize } from '../services/offers.service';

function salonIdOf(req: Request): string {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return req.staff.salonId;
}

export async function getOffers(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listOffers(salonIdOf(req)));
  } catch (err) { next(err); }
}

export async function postOffer(req: Request, res: Response, next: NextFunction) {
  try {
    const body = offerBodySchema.parse(req.body);
    res.status(201).json({ offer: await createOffer(salonIdOf(req), body) });
  } catch (err) { next(err); }
}

export async function patchOffer(req: Request, res: Response, next: NextFunction) {
  try {
    const { offerId } = offerIdParamSchema.parse(req.params);
    const body = offerPatchSchema.parse(req.body);
    res.json({ offer: await updateOffer(salonIdOf(req), offerId, body) });
  } catch (err) { next(err); }
}

export async function removeOffer(req: Request, res: Response, next: NextFunction) {
  try {
    const { offerId } = offerIdParamSchema.parse(req.params);
    await deleteOffer(salonIdOf(req), offerId);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function postRedeem(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = redeemBodySchema.parse(req.body);
    res.json(await redeemPrize(salonIdOf(req), code));
  } catch (err) { next(err); }
}