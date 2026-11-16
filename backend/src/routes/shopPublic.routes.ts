// backend/src/routes/shopPublic.routes.ts — mounted at /api/shop (Commerce Phase 1, C2). Read-only, no login.
// /status always answers; everything else is 404 while the shop_enabled flag is off.
// C3: product details + server quote. C4 adds the customer session, checkout and orders here, with the same-origin + CSRF rules as the admin side.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { requireContentType, requireSameOrigin } from '../middleware/shopSecurity.middleware';
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

export default router;
