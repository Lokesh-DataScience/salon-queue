// backend/src/controllers/shopAdmin.controller.ts — /api/admin/shop/* (Commerce Phase 1, C1).
// Behind requireAuth + requireAdminRole('FOUNDER') (FOUNDER and COFOUNDER can read).
// Every non-GET route is also behind requireSameOrigin + requireFounder + content-type + admin CSRF.
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { adminRoleOf } from '../middleware/admin.middleware';
import { issueAdminCsrfToken } from '../middleware/shopSecurity.middleware';
import type { Actor } from '../services/founderSalons.service';
import * as shop from '../services/shopAdmin.service';
import * as orders from '../services/shopOrdersAdmin.service';
import * as money from '../services/shopMoneyAdmin.service';
import {
  shopDispositionBodySchema,
  shopOrderLineParamSchema,
  shopRefundPaidBodySchema,
  shopResolveReturnBodySchema,
  shopReturnBodySchema,
  shopReturnIdParamSchema,
  shopCustomerIdParamSchema,
  shopCustomerKeyParamSchema,
  shopExpenseBodySchema,
  shopExpenseIdParamSchema,
  shopReportQuerySchema,
  shopSettlementBodySchema,
  shopVoidExpenseBodySchema,
  shopCodCollectionBodySchema,
  shopDeliveryExpectationBodySchema,
  shopOrderIdParamSchema,
  shopOrderListQuerySchema,
  shopOrderTransitionBodySchema,
  shopAvailabilityBodySchema,
  shopCategoryIdParamSchema,
  shopCreateCategoryBodySchema,
  shopCreateProductBodySchema,
  shopImageParamSchema,
  shopImageUpdateBodySchema,
  shopMovementsQuerySchema,
  shopProductIdParamSchema,
  shopProductListQuerySchema,
  shopSettingsBodySchema,
  shopStockChangeBodySchema,
  shopStockCheckBodySchema,
  shopSupplierBodySchema,
  shopUpdateCategoryBodySchema,
  shopUpdateProductBodySchema,
} from '../validators/shopAdmin.validators';

function actorOf(req: Request, res: Response): Actor {
  if (!req.staff) throw new AppError('Not authenticated.', 401);
  return { staffId: req.staff.staffId, salonId: req.staff.salonId, role: adminRoleOf(res) };
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
// Every shop admin answer is private and changes often: never cache it.
const wrap =
  (fn: Handler, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = await fn(req, res);
      res.setHeader('Cache-Control', 'no-store');
      res.status(status).json(body);
    } catch (err) {
      next(err);
    }
  };

export const postSession = wrap(async (req) => issueAdminCsrfToken(req.staff!.staffId));

export const getProducts = wrap(async (req) => ({
  products: await shop.listProducts(shopProductListQuerySchema.parse(req.query)),
}));
export const getProduct = wrap(async (req) => ({
  product: await shop.getProduct(shopProductIdParamSchema.parse(req.params).productId),
}));
export const getMovements = wrap(async (req) => {
  const { productId } = shopProductIdParamSchema.parse(req.params);
  const { limit } = shopMovementsQuerySchema.parse(req.query);
  return { movements: await shop.listMovements(productId, limit) };
});
export const getCategories = wrap(async () => ({ categories: await shop.listCategories() }));
export const getSettings = wrap(async () => shop.getSettings());

export const postProduct = wrap(
  async (req, res) => ({ product: await shop.createProduct(actorOf(req, res), shopCreateProductBodySchema.parse(req.body)) }),
  201,
);
export const patchProduct = wrap(async (req, res) => {
  const { productId } = shopProductIdParamSchema.parse(req.params);
  return { product: await shop.updateProduct(actorOf(req, res), productId, shopUpdateProductBodySchema.parse(req.body)) };
});
export const removeProduct = wrap(async (req, res) => {
  await shop.deleteProduct(actorOf(req, res), shopProductIdParamSchema.parse(req.params).productId);
  return { ok: true };
});
export const postAvailability = wrap(async (req, res) => {
  const { productId } = shopProductIdParamSchema.parse(req.params);
  const { available } = shopAvailabilityBodySchema.parse(req.body);
  return { product: await shop.setAvailability(actorOf(req, res), productId, available) };
});
export const postStock = wrap(async (req, res) => {
  const { productId } = shopProductIdParamSchema.parse(req.params);
  return { product: await shop.changeStock(actorOf(req, res), productId, shopStockChangeBodySchema.parse(req.body)) };
});
export const postStockCheck = wrap(async (req, res) => {
  const { items } = shopStockCheckBodySchema.parse(req.body);
  return shop.dailyStockCheck(actorOf(req, res), items);
});

// Raw image bytes in the body (express.raw on this route only); optional ?alt= text.
export const postImage = wrap(async (req, res) => {
  const { productId } = shopProductIdParamSchema.parse(req.params);
  const alt = typeof req.query.alt === 'string' ? req.query.alt.trim().slice(0, 120) : '';
  const type = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return { product: await shop.addImage(actorOf(req, res), productId, type, req.body as Buffer, alt) };
}, 201);
export const patchImage = wrap(async (req, res) => {
  const { productId, imageId } = shopImageParamSchema.parse(req.params);
  return { product: await shop.updateImage(actorOf(req, res), productId, imageId, shopImageUpdateBodySchema.parse(req.body)) };
});
export const removeImage = wrap(async (req, res) => {
  const { productId, imageId } = shopImageParamSchema.parse(req.params);
  return { product: await shop.deleteImage(actorOf(req, res), productId, imageId) };
});

export const postCategory = wrap(
  async (req, res) => ({ category: await shop.saveCategory(actorOf(req, res), null, shopCreateCategoryBodySchema.parse(req.body)) }),
  201,
);
export const patchCategory = wrap(async (req, res) => {
  const { categoryId } = shopCategoryIdParamSchema.parse(req.params);
  return { category: await shop.saveCategory(actorOf(req, res), categoryId, shopUpdateCategoryBodySchema.parse(req.body)) };
});

export const patchSettings = wrap(async (req, res) => shop.updateSettings(actorOf(req, res), shopSettingsBodySchema.parse(req.body)));
export const patchSupplier = wrap(async (req, res) => shop.updateSupplier(actorOf(req, res), shopSupplierBodySchema.parse(req.body)));

// ── Orders (C5a) ─────────────────────────────────────────────────────────

export const getOrders = wrap(async (req) => orders.listOrders(shopOrderListQuerySchema.parse(req.query)));
export const getOrder = wrap(async (req) => orders.getOrder(shopOrderIdParamSchema.parse(req.params).orderId));
export const getSupplierText = wrap(async (req) => orders.getSupplierText(shopOrderIdParamSchema.parse(req.params).orderId));
export const postOrderTransition = wrap(async (req, res) => {
  const { orderId } = shopOrderIdParamSchema.parse(req.params);
  return orders.transitionOrder(actorOf(req, res), orderId, shopOrderTransitionBodySchema.parse(req.body));
});
export const postDeliveryExpectation = wrap(async (req, res) => {
  const { orderId } = shopOrderIdParamSchema.parse(req.params);
  return orders.setDeliveryExpectation(actorOf(req, res), orderId, shopDeliveryExpectationBodySchema.parse(req.body));
});
export const postCodCollection = wrap(async (req, res) => {
  const { orderId } = shopOrderIdParamSchema.parse(req.params);
  return orders.recordCodCollection(actorOf(req, res), orderId, shopCodCollectionBodySchema.parse(req.body));
});

// ── Money and recovery (C5b) ─────────────────────────────────────────────

export const getPendingSettlement = wrap(async () => money.pendingSettlement());
export const getSettlements = wrap(async () => money.listSettlements());
export const postSettlement = wrap(async (req, res) => money.recordSettlement(actorOf(req, res), shopSettlementBodySchema.parse(req.body)));
export const postExpense = wrap(async (req, res) => {
  const { orderId } = shopOrderIdParamSchema.parse(req.params);
  await money.addExpense(actorOf(req, res), orderId, shopExpenseBodySchema.parse(req.body));
  return orders.getOrder(orderId);
});
export const postVoidExpense = wrap(async (req, res) => {
  const { expenseId } = shopExpenseIdParamSchema.parse(req.params);
  const { orderId } = await money.voidExpense(actorOf(req, res), expenseId, shopVoidExpenseBodySchema.parse(req.body).reason);
  return orders.getOrder(orderId);
});
export const getReport = wrap(async (req) => {
  const { from, to } = shopReportQuerySchema.parse(req.query);
  return money.report(from, to);
});
export const getCustomer = wrap(async (req) => money.getCustomer(shopCustomerIdParamSchema.parse(req.params).customerId));
export const postRecoveryCode = wrap(async (req, res) =>
  money.createRecoveryCode(actorOf(req, res), shopCustomerIdParamSchema.parse(req.params).customerId),
);
export const postRevokeKey = wrap(async (req, res) => {
  const { customerId, keyId } = shopCustomerKeyParamSchema.parse(req.params);
  return money.revokeKey(actorOf(req, res), customerId, keyId);
});

// ── Stock decisions, returns, refunds (C6) ───────────────────────────────

export const postDisposition = wrap(async (req, res) => {
  const { orderId, lineId } = shopOrderLineParamSchema.parse(req.params);
  return orders.disposeLine(actorOf(req, res), orderId, lineId, shopDispositionBodySchema.parse(req.body));
});
export const postReturn = wrap(async (req, res) => {
  const { orderId, lineId } = shopOrderLineParamSchema.parse(req.params);
  return orders.recordReturn(actorOf(req, res), orderId, lineId, shopReturnBodySchema.parse(req.body));
});
export const postResolveReturn = wrap(async (req, res) => {
  const { returnId } = shopReturnIdParamSchema.parse(req.params);
  return orders.resolveReturn(actorOf(req, res), returnId, shopResolveReturnBodySchema.parse(req.body));
});
export const postRefundPaid = wrap(async (req, res) => {
  const { returnId } = shopReturnIdParamSchema.parse(req.params);
  return orders.markRefundPaid(actorOf(req, res), returnId, shopRefundPaidBodySchema.parse(req.body).method);
});
