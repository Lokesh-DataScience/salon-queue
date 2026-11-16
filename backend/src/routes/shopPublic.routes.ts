// backend/src/routes/shopPublic.routes.ts — mounted at /api/shop (Commerce Phase 1, C2). Read-only, no login.
// /status always answers; everything else is 404 while the shop_enabled flag is off.
// C3: product details + server quote. C4 adds the customer session, checkout and orders here, with the same-origin + CSRF rules as the admin side.
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import { normalizePhone } from '../utils/phone';
import { AppError } from '../middleware/errorHandler';
import {
  CUSTOMER_CSRF_HEADER,
  SHOP_BLOCKED_MESSAGE,
  issueCustomerCsrfToken,
  requireContentType,
  requireSameOrigin,
  verifyCustomerCsrfToken,
} from '../middleware/shopSecurity.middleware';
import {
  SHOP_ACCESS_COOKIE,
  SHOP_ACCESS_COOKIE_OPTS,
  accessFromCookie,
  cancelMyOrder,
  createLinkCode,
  ensureSession,
  getMyOrder,
  listMyOrders,
  placeOrder,
  prefillFor,
  redeemLinkCode,
  saveDetails,
  verifiedCustomer,
  type ShopAccess,
} from '../services/shopCustomer.service';
import {
  getPublicProduct,
  listPublicCategories,
  listPublicProducts,
  quoteCart,
  shopFlag,
  shopStatus,
} from '../services/shopPublic.service';

const statusQuery = z.object({ salonId: z.string().uuid().optional() });
const productsQuery = z.object({ categoryId: z.string().uuid().optional() });
const productParams = z.object({ productId: z.string().uuid() });
const quoteBody = z
  .object({
    items: z
      .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(20) }).strict())
      .min(1)
      .max(20)
      .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, 'Each product can appear only once.'),
  })
  .strict();

const orderParams = z.object({ orderId: z.string().uuid() });
const checkoutBody = z
  .object({
    items: quoteBody.shape.items,
    expectedTotalPaise: z.number().int().min(1).max(10_000_000),
    customer: z
      .object({
        name: z.string().trim().min(1, 'Enter your name.').max(80),
        phone: z
          .string()
          .trim()
          .transform((v, ctx) => {
            const p = normalizePhone(v);
            if (!p || !/^\+91[6-9]\d{9}$/.test(p)) {
              ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number.' });
              return z.NEVER;
            }
            return p;
          }),
        addressLine1: z.string().trim().min(3, 'Enter your house / street.').max(200),
        addressLine2: z.string().trim().max(200).default(''),
        landmark: z.string().trim().max(120).default(''),
        pincode: z
          .string()
          .trim()
          .regex(/^([1-9][0-9]{5})?$/, 'Pincode must be 6 digits (or leave it empty).')
          .default(''),
      })
      .strict(),
    consent: z.literal(true, { error: 'Please agree to saving your details for delivery.' }),
    requestSameDay: z.boolean().default(false),
  })
  .strict();
const cancelBody = z.object({ reason: z.string().trim().max(300).default('') }).strict();
const redeemBody = z.object({ code: z.string().trim().min(8).max(12) }).strict();
const detailsBody = z
  .object({
    name: checkoutBody.shape.customer.shape.name,
    addressLine1: checkoutBody.shape.customer.shape.addressLine1,
    addressLine2: checkoutBody.shape.customer.shape.addressLine2,
    landmark: checkoutBody.shape.customer.shape.landmark,
    pincode: checkoutBody.shape.customer.shape.pincode,
  })
  .strict();
const idempotencyHeader = z.string().uuid();

const access = (res: Response) => (res.locals.shopAccess as ShopAccess | null | undefined) ?? null;

// Loads this device's access from the HttpOnly cookie (or null). Never trusted from anything else.
async function loadAccess(req: Request, res: Response, next: NextFunction) {
  try {
    res.locals.shopAccess = await accessFromCookie(req.cookies?.[SHOP_ACCESS_COOKIE]);
    next();
  } catch (err) {
    next(err);
  }
}

// Every customer change (§9.3): same origin → JSON only → a valid device cookie → its CSRF token.
// A refusal is 403 "blocked", which makes the app fetch a fresh session and retry once.
const customerWrite = [
  requireSameOrigin,
  requireContentType(),
  (req: Request, res: Response, next: NextFunction) => {
    const a = access(res);
    if (!a || !verifyCustomerCsrfToken(a.keyId, req.get(CUSTOMER_CSRF_HEADER))) {
      return next(new AppError(SHOP_BLOCKED_MESSAGE, 403));
    }
    next();
  },
];

// Checkout per device (§9.5): 10 an hour. Per-network ceilings live in app.ts.
const perProfileCheckout = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (_req, res) => access(res)?.profileId ?? 'none',
  skip: () => env.NODE_ENV === 'test',
  message: { message: 'Too many orders from this phone. Please try again later.' },
});

// Device linking (§9.5): codes 10/hour per phone; redeem 5 per 15 minutes per phone (IP ceiling in app.ts).
const perProfile = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (_req, res) => access(res)?.profileId ?? 'none',
    skip: () => env.NODE_ENV === 'test',
    message: { message },
  });
const linkCodeLimit = perProfile(60 * 60_000, 10, 'Too many codes. Please try again later.');
const redeemLimit = perProfile(15 * 60_000, 5, 'Too many tries. Please wait 15 minutes and try again.');

const router = Router();

// The catalog changes rarely; a short browser cache keeps the strip cheap. Status is never cached long,
// so switching the flag off hides the shop within a minute.
router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { salonId } = statusQuery.parse(req.query);
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.json(await shopStatus(salonId));
  } catch (err) {
    next(err);
  }
});

router.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    if (!(await shopFlag()).enabled) return next(new AppError('Not found.', 404));
    next();
  } catch (err) {
    next(err);
  }
});
router.use(loadAccess);

router.get('/categories', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ categories: await listPublicCategories() });
  } catch (err) {
    next(err);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const { categoryId } = productsQuery.parse(req.query);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ products: await listPublicProducts(categoryId) });
  } catch (err) {
    next(err);
  }
});

router.get('/products/:productId', async (req, res, next) => {
  try {
    const { productId } = productParams.parse(req.params);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ product: await getPublicProduct(productId) });
  } catch (err) {
    next(err);
  }
});

// Quote: reads only and reserves nothing, but it is a POST, so it gets the same-origin + JSON-only rules.
// (The customer CSRF token arrives with the customer session in C4, for the routes that change data.)
router.post('/quote', requireSameOrigin, requireContentType(), async (req, res, next) => {
  try {
    const { items } = quoteBody.parse(req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ quote: await quoteCart(items) });
  } catch (err) {
    next(err);
  }
});

// ── C4: customer session, checkout, orders ───────────────────────────────

// Session bootstrap (D21): creates the device cookie if missing and returns a CSRF token (kept in JS memory).
// Called when the cart, checkout or My Orders open — never on plain browsing, so visitors create no rows.
router.post('/session', requireSameOrigin, requireContentType(), async (_req, res, next) => {
  try {
    const { access: a, newCookie } = await ensureSession(access(res));
    if (newCookie) res.cookie(SHOP_ACCESS_COOKIE, newCookie, SHOP_ACCESS_COOKIE_OPTS);
    res.setHeader('Cache-Control', 'no-store');
    res.json(issueCustomerCsrfToken(a.keyId));
  } catch (err) {
    next(err);
  }
});

router.get('/prefill', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const prefill = await prefillFor(access(res));
    res.json({ prefill, verified: prefill?.source === 'saved' });
  } catch (err) {
    next(err);
  }
});

router.post('/orders', ...customerWrite, perProfileCheckout, async (req, res, next) => {
  try {
    const key = idempotencyHeader.safeParse(req.get('idempotency-key'));
    if (!key.success) throw new AppError('Missing order key. Please refresh and try again.', 400);
    const body = checkoutBody.parse(req.body);
    const r = await placeOrder(access(res)!, key.data, body);
    res.setHeader('Cache-Control', 'no-store');
    switch (r.kind) {
      case 'CREATED':
      case 'EXISTING':
        res.status(r.kind === 'CREATED' ? 201 : 200).json({ order: { id: r.orderId, orderNumber: r.orderNumber }, existing: r.kind === 'EXISTING' });
        return;
      case 'PRICE_CHANGED':
        res.status(409).json({ code: 'PRICE_CHANGED', message: 'Prices changed. Please check the new total.', quote: r.quote });
        return;
      case 'CART_PROBLEM':
        res.status(409).json({ code: 'CART_PROBLEM', message: 'Something in your cart changed. Please check it.', quote: r.quote });
        return;
      case 'TOO_MANY_OPEN_ORDERS':
        res.status(409).json({
          code: 'TOO_MANY_OPEN_ORDERS',
          max: r.max,
          message: `You already have ${r.max} orders on the way. Please wait for one to arrive first.`,
        });
        return;
      case 'IDEMPOTENCY_MISMATCH':
        res.status(422).json({ code: 'IDEMPOTENCY_MISMATCH', message: 'Your earlier order may have gone through. Check My Orders.' });
        return;
    }
  } catch (err) {
    next(err);
  }
});

router.get('/orders', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ orders: await listMyOrders(access(res)) });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:orderId', async (req, res, next) => {
  try {
    const { orderId } = orderParams.parse(req.params);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ order: await getMyOrder(access(res), orderId) });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:orderId/cancel', ...customerWrite, async (req, res, next) => {
  try {
    const { orderId } = orderParams.parse(req.params);
    const { reason } = cancelBody.parse(req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ order: await cancelMyOrder(access(res)!, orderId, reason) });
  } catch (err) {
    next(err);
  }
});

// ── C4b: device linking + saved details ──────────────────────────────────

router.post('/device-link/code', ...customerWrite, linkCodeLimit, async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await createLinkCode(access(res)!));
  } catch (err) {
    next(err);
  }
});

router.post('/device-link/redeem', ...customerWrite, redeemLimit, async (req, res, next) => {
  try {
    const { code } = redeemBody.parse(req.body);
    const r = await redeemLinkCode(access(res)!, code);
    res.setHeader('Cache-Control', 'no-store');
    if (r.kind === 'LINKED') {
      res.cookie(SHOP_ACCESS_COOKIE, r.newCookie, SHOP_ACCESS_COOKIE_OPTS);
      res.json({ linked: true, ...issueCustomerCsrfToken(r.access.keyId) });
      return;
    }
    const message = {
      INVALID_CODE: 'That code is wrong or has expired. Make a new code on your other phone.',
      SAME_PROFILE: 'This phone is already linked.',
      HAS_OWN_ORDERS: 'This phone already has its own orders. Make the code on THIS phone and enter it on the other one instead.',
    }[r.kind];
    res.status(r.kind === 'INVALID_CODE' ? 400 : 409).json({ code: r.kind, message });
  } catch (err) {
    next(err);
  }
});

router.post('/details', ...customerWrite, async (req, res, next) => {
  try {
    const body = detailsBody.parse(req.body);
    if (!(await verifiedCustomer(access(res)))) {
      throw new AppError('Only a phone confirmed by the shop can change your saved details. Your order still uses what you typed.', 403);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(await saveDetails(access(res)!, body));
  } catch (err) {
    next(err);
  }
});

export default router;
