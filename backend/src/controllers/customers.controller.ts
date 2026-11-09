// backend/src/controllers/customers.controller.ts
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { listCustomers, deleteCustomer } from '../services/customers.service';

const listQuerySchema = z.object({ search: z.string().trim().max(40).optional() });
const customerParamSchema = z.object({ customerId: z.string().uuid() });

// The salon always comes from the verified login (req.staff), never from the URL or body.
export async function getCustomers(req: Request, res: Response, next: NextFunction) {
  try {
    const { search } = listQuerySchema.parse(req.query);
    const customers = await listCustomers(req.staff!.salonId, search);
    res.json({ customers });
  } catch (err) {
    next(err);
  }
}

export async function removeCustomer(req: Request, res: Response, next: NextFunction) {
  try {
    const { customerId } = customerParamSchema.parse(req.params);
    const ok = await deleteCustomer(req.staff!.salonId, customerId);
    // Another salon's customer and a missing one look identical.
    if (!ok) return res.status(404).json({ message: 'Customer not found.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}