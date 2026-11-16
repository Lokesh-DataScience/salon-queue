// backend/tests/shopSecurity.unit.test.ts — no database. Origin / Fetch-Metadata / content-type / CSRF rules
// (§9.3) and image sniffing. Run:  npx vitest run tests/shopSecurity.unit.test.ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  ADMIN_CSRF_TTL_MS,
  appOrigin,
  issueAdminCsrfToken,
  requireContentType,
  requireSameOrigin,
  verifyAdminCsrfToken,
  issueCustomerCsrfToken,
  verifyCustomerCsrfToken,
} from '../src/middleware/shopSecurity.middleware';
import { requestHash, type CheckoutInput } from '../src/services/shopCustomer.service';
import { errorHandler } from '../src/middleware/errorHandler';
import { shopDbError, sniffImageType } from '../src/services/shopAdmin.service';
import { AppError } from '../src/middleware/errorHandler';

const STAFF = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('admin CSRF token', () => {
  it('verifies for the same staff member only', () => {
    const { csrfToken } = issueAdminCsrfToken(STAFF);
    expect(verifyAdminCsrfToken(STAFF, csrfToken)).toBe(true);
    expect(verifyAdminCsrfToken(OTHER, csrfToken)).toBe(false);
  });

  it('expires, and rejects future or malformed tokens', () => {
    const t0 = Date.now();
    const { csrfToken } = issueAdminCsrfToken(STAFF, t0);
    expect(verifyAdminCsrfToken(STAFF, csrfToken, t0 + ADMIN_CSRF_TTL_MS + 1)).toBe(false);
    expect(verifyAdminCsrfToken(STAFF, issueAdminCsrfToken(STAFF, t0 + 10 * 60_000).csrfToken, t0)).toBe(false);
    for (const bad of [undefined, '', 'abc', '.x', `${t0}.`, `${t0}.${'a'.repeat(43)}`, 'x'.repeat(500)]) {
      expect(verifyAdminCsrfToken(STAFF, bad, t0), String(bad)).toBe(false);
    }
  });

  it('a tampered timestamp fails', () => {
    const t0 = Date.now();
    const sig = issueAdminCsrfToken(STAFF, t0).csrfToken.split('.')[1];
    expect(verifyAdminCsrfToken(STAFF, `${t0 + 1}.${sig}`, t0 + 1)).toBe(false);
  });
});

describe('same-origin + content-type rules', () => {
  const app = express();
  app.use(requireSameOrigin, requireContentType());
  app.all('/x', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const O = appOrigin();

  it('GET is never blocked', async () => {
    expect((await request(app).get('/x')).status).toBe(200);
  });

  it.each([
    ['right Origin', { Origin: O }, 200],
    ['right Origin + same-origin fetch', { Origin: O, 'Sec-Fetch-Site': 'same-origin' }, 200],
    ['Referer only', { Referer: `${O}/barber/admin` }, 200],
    ['wrong Origin', { Origin: 'https://evil.example' }, 403],
    ['Origin that only starts with ours', { Origin: `${O}.evil.example` }, 403],
    ['Referer on another site', { Referer: `${O}.evil.example/x` }, 403],
    ['neither Origin nor Referer', {}, 403],
    ['cross-site fetch', { Origin: O, 'Sec-Fetch-Site': 'cross-site' }, 403],
    ['no Sec-Fetch-Site value "none"', { Origin: O, 'Sec-Fetch-Site': 'none' }, 403],
  ])('%s', async (_name, headers, status) => {
    const r = await request(app).post('/x').set(headers as Record<string, string>).send({ a: 1 });
    expect(r.status).toBe(status);
  });

  it('plain HTML form posts are blocked', async () => {
    const r = await request(app).post('/x').set('Origin', O).type('form').send('a=1');
    expect(r.status).toBe(403);
  });
});

describe('image sniffing', () => {
  it('recognises real JPG / PNG / WebP headers only', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
  });
});

describe('database error mapping', () => {
  const map = (e: object) => {
    try {
      shopDbError(e);
    } catch (err) {
      return err;
    }
  };
  it('maps shop codes and constraints to readable messages', () => {
    expect(map({ message: 'SHOP_FORBIDDEN', code: 'P0001' })).toMatchObject({ statusCode: 403 });
    expect(map({ message: 'SHOP_STALE', code: 'P0001' })).toMatchObject({ statusCode: 409 });
    expect(map({ code: '23505', message: 'duplicate key value violates unique constraint "products_sku_live_uq"' })).toMatchObject({
      statusCode: 409,
      message: 'Another product already uses this SKU.',
    });
    expect(map({ code: '23514', message: 'new row violates check constraint "products_price_below_mrp"' })).toMatchObject({
      statusCode: 400,
      message: 'Selling price must be lower than MRP.',
    });
  });
  it('re-throws unknown errors untouched (so they become a logged 500)', () => {
    const unknown = { code: 'XX000', message: 'boom' };
    expect(map(unknown)).toBe(unknown);
    expect(map(unknown)).not.toBeInstanceOf(AppError);
  });
});

describe('customer CSRF token (bound to the device key)', () => {
  it('works for its own key only, and an admin token is not a customer token', () => {
    const { csrfToken } = issueCustomerCsrfToken(STAFF);
    expect(verifyCustomerCsrfToken(STAFF, csrfToken)).toBe(true);
    expect(verifyCustomerCsrfToken(OTHER, csrfToken)).toBe(false);
    expect(verifyCustomerCsrfToken(STAFF, issueAdminCsrfToken(STAFF).csrfToken)).toBe(false);
    expect(verifyAdminCsrfToken(STAFF, csrfToken)).toBe(false);
  });
});

describe('checkout request hash', () => {
  const base: CheckoutInput = {
    items: [{ productId: 'b', qty: 1 }, { productId: 'a', qty: 2 }],
    expectedTotalPaise: 100,
    customer: { name: 'A', phone: '+919876543210', addressLine1: 'x', addressLine2: '', landmark: '', pincode: '' },
    consent: true,
    requestSameDay: false,
  };
  it('ignores item order and the expected total; changes with anything else', () => {
    const h = requestHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(requestHash({ ...base, items: [...base.items].reverse() })).toBe(h);
    expect(requestHash({ ...base, expectedTotalPaise: 999 })).toBe(h);
    expect(requestHash({ ...base, requestSameDay: true })).not.toBe(h);
    expect(requestHash({ ...base, customer: { ...base.customer, landmark: 'temple' } })).not.toBe(h);
    expect(requestHash({ ...base, items: [{ productId: 'a', qty: 3 }, { productId: 'b', qty: 1 }] })).not.toBe(h);
  });
});
