// backend/src/routes/shopAdmin.routes.ts — mounted at /api/admin/shop (after requireAuth).
// Read: FOUNDER + COFOUNDER (D7). Everything else 404 (SALES, TECH, barbers).
// Write (any non-GET): same-origin → FOUNDER only (403) → content type → admin CSRF token.
// Default-deny: the write guard sits on the router, so a route added later can't skip it.
import express, { Router } from 'express';
import { requireAdminRole, requireFounder } from '../middleware/admin.middleware';
import { requireAdminCsrf, requireContentType, requireSameOrigin } from '../middleware/shopSecurity.middleware';
import { SHOP_IMAGE_MAX_BYTES, SHOP_IMAGE_TYPES } from '../services/shopAdmin.service';
import * as c from '../controllers/shopAdmin.controller';

const IMAGE_ROUTE = /^\/products\/[^/]+\/images\/?$/;

const shop = Router();
shop.use(requireAdminRole('FOUNDER'));

// Write guard for every non-GET request.
shop.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  requireSameOrigin(req, res, (err?: unknown) => {
    if (err) return next(err);
    requireFounder()(req, res, (err2?: unknown) => {
      if (err2) return next(err2);
      const isImageUpload = req.method === 'POST' && IMAGE_ROUTE.test(req.path);
      requireContentType(isImageUpload ? [...SHOP_IMAGE_TYPES] : ['application/json'])(req, res, (err3?: unknown) => {
        if (err3) return next(err3);
        if (req.path === '/session') return next(); // issues the token; nothing to protect yet
        requireAdminCsrf(req, res, next);
      });
    });
  });
});

shop.post('/session', c.postSession);

shop.get('/products', c.getProducts);
shop.post('/products', c.postProduct);
shop.get('/products/:productId', c.getProduct);
shop.patch('/products/:productId', c.patchProduct);
shop.delete('/products/:productId', c.removeProduct);
shop.post('/products/:productId/availability', c.postAvailability);
shop.post('/products/:productId/stock', c.postStock);
shop.get('/products/:productId/movements', c.getMovements);
shop.post(
  '/products/:productId/images',
  express.raw({ type: [...SHOP_IMAGE_TYPES], limit: SHOP_IMAGE_MAX_BYTES }),
  c.postImage,
);
shop.patch('/products/:productId/images/:imageId', c.patchImage);
shop.delete('/products/:productId/images/:imageId', c.removeImage);

shop.post('/stock/check', c.postStockCheck);

shop.get('/categories', c.getCategories);
shop.post('/categories', c.postCategory);
shop.patch('/categories/:categoryId', c.patchCategory);

shop.get('/settings', c.getSettings);
shop.patch('/settings', c.patchSettings);
shop.patch('/supplier', c.patchSupplier);

// C5a: orders
shop.get('/orders', c.getOrders);
shop.get('/orders/:orderId', c.getOrder);
shop.get('/orders/:orderId/supplier-text', c.getSupplierText);
shop.post('/orders/:orderId/transition', c.postOrderTransition);
shop.post('/orders/:orderId/delivery-expectation', c.postDeliveryExpectation);
shop.post('/orders/:orderId/cod-collection', c.postCodCollection);

export default shop;
