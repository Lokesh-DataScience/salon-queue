// backend/tests/shopPublic.test.ts — Commerce Phase 1, C2: customer catalog behind the shop_enabled flag.
// Needs step21 + step21a on the TESTS project and TEST_FOUNDER_* in .env.test.
// Run on its own:  npx vitest run tests/shopPublic.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';
import { listFlags } from '../src/services/flags.service';
import { ORIGIN, founderSession, productBody, shopApi, softDeleteProducts } from './shopHelpers';

type Session = Awaited<ReturnType<typeof founderSession>>;
let founder: Session;
let original: { enabled: boolean; value: string };
const created: string[] = [];

async function setFlag(enabled: boolean, value: string) {
  const { error } = await supabase.from('feature_flags').update({ enabled, value }).eq('key', 'shop_enabled');
  if (error) throw new Error(error.message);
  await listFlags(true); // the app caches flags for 30 s; refresh now
}

async function product(overrides: Record<string, unknown>, visible: boolean) {
  const r = await shopApi(founder).post('/products', productBody(overrides));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  created.push(r.body.product.id);
  if (visible) await shopApi(founder).post(`/products/${r.body.product.id}/availability`, { available: true });
  return r.body.product.id as string;
}

beforeAll(async () => {
  founder = await founderSession();
  const { data, error } = await supabase.from('feature_flags').select('enabled, value').eq('key', 'shop_enabled').single();
  if (error) throw new Error(`shop_enabled flag missing — run step21a_shop_flag.sql on the tests project. (${error.message})`);
  original = { enabled: data.enabled, value: data.value };
}, 60_000);

afterAll(async () => {
  await setFlag(original.enabled, original.value);
  await softDeleteProducts(founder, created);
  await cleanupSalons();
}, 120_000);

describe('Customer shop — switched off', () => {
  it('says disabled and hides the catalog', async () => {
    await setFlag(false, 'internal');
    const s = await request(app).get('/api/shop/status');
    expect(s.status).toBe(200);
    expect(s.body).toEqual({ enabled: false, showStrip: false });
    expect((await request(app).get('/api/shop/products')).status).toBe(404);
    expect((await request(app).get('/api/shop/categories')).status).toBe(404);
  });
});

describe('Customer shop — switched on', () => {
  it('lists only visible products, with public fields only', async () => {
    await setFlag(true, 'internal');
    const shown = await product({ name: 'TEST Visible Oil', mrpPaise: 20000, sellingPricePaise: 15000, initialStock: 10 }, true);
    const hidden = await product({ name: 'TEST Hidden Oil' }, false);

    const r = await request(app).get('/api/shop/products');
    expect(r.status).toBe(200);
    const ids = r.body.products.map((p: { id: string }) => p.id);
    expect(ids).toContain(shown);
    expect(ids).not.toContain(hidden);

    const p = r.body.products.find((x: { id: string }) => x.id === shown);
    expect(Object.keys(p).sort()).toEqual(
      ['availability', 'brand', 'categoryId', 'discountPercent', 'id', 'image', 'mrpPaise', 'name', 'sellingPricePaise'].sort(),
    );
    expect(p).toMatchObject({ mrpPaise: 20000, sellingPricePaise: 15000, discountPercent: 25, availability: 'IN_STOCK', image: null });
    const raw = JSON.stringify(r.body);
    for (const secret of ['wholesale', 'sku', 'stockOnHand', 'stock_on_hand', 'margin', 'supplier']) {
      expect(raw.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  }, 120_000);

  it('labels stock without revealing numbers (buffer and reservations count)', async () => {
    await setFlag(true, 'internal');
    const low = await product({ initialStock: 4, stockBuffer: 1 }, true); // 3 sellable
    const out = await product({ initialStock: 2, stockBuffer: 2 }, true); // 0 sellable
    const r = await request(app).get('/api/shop/products');
    const byId = Object.fromEntries(r.body.products.map((p: { id: string; availability: string }) => [p.id, p.availability]));
    expect(byId[low]).toBe('LOW_STOCK');
    expect(byId[out]).toBe('OUT_OF_STOCK');
  }, 120_000);

  it('categories list only active ones in use', async () => {
    await setFlag(true, 'internal');
    const cats = (await shopApi(founder).get('/categories')).body.categories as { id: string; slug: string }[];
    const beard = cats.find((c) => c.slug === 'beard-care')!;
    await product({ categoryId: beard.id }, true);
    const r = await request(app).get('/api/shop/categories');
    expect(r.status).toBe(200);
    expect(r.body.categories.map((c: { id: string }) => c.id)).toContain(beard.id);
    const filtered = await request(app).get(`/api/shop/products?categoryId=${beard.id}`);
    expect(filtered.body.products.every((p: { categoryId: string }) => p.categoryId === beard.id)).toBe(true);
  }, 120_000);

  it('strip: internal salons only by default, every salon with value "all"', async () => {
    const internal = await makeSalon({ is_internal: true });
    const real = await makeSalon({ is_internal: false });
    await setFlag(true, 'internal');
    expect((await request(app).get(`/api/shop/status?salonId=${internal}`)).body).toEqual({ enabled: true, showStrip: true });
    expect((await request(app).get(`/api/shop/status?salonId=${real}`)).body).toEqual({ enabled: true, showStrip: false });
    expect((await request(app).get('/api/shop/status')).body).toEqual({ enabled: true, showStrip: false });
    await setFlag(true, 'all');
    expect((await request(app).get(`/api/shop/status?salonId=${real}`)).body).toEqual({ enabled: true, showStrip: true });
    expect((await request(app).get('/api/shop/status?salonId=not-a-uuid')).status).toBe(400);
  }, 120_000);
});

describe('Customer shop — product page and quote (C3)', () => {
  const quote = (items: object[], headers: Record<string, string> = { Origin: ORIGIN }) =>
    request(app).post('/api/shop/quote').set(headers).send({ items });

  it('product page: visible products only, public fields only', async () => {
    await setFlag(true, 'internal');
    const shown = await product({ description: 'Nice oil', maxPerOrder: 3 }, true);
    const hidden = await product({}, false);
    const r = await request(app).get(`/api/shop/products/${shown}`);
    expect(r.status).toBe(200);
    expect(r.body.product).toMatchObject({ id: shown, description: 'Nice oil', maxPerOrder: 3, images: [] });
    expect(JSON.stringify(r.body).toLowerCase()).not.toMatch(/wholesale|sku|stock_on_hand|stockonhand|margin|supplier/);
    expect((await request(app).get(`/api/shop/products/${hidden}`)).status).toBe(404);
    expect((await request(app).get('/api/shop/products/not-a-uuid')).status).toBe(400);
  }, 120_000);

  it('prices on the server and flags problems per line', async () => {
    await setFlag(true, 'internal');
    const a = await product({ mrpPaise: 25000, sellingPricePaise: 22000, initialStock: 6, stockBuffer: 1, maxPerOrder: 3 }, true);
    const b = await product({ mrpPaise: 15000, sellingPricePaise: 12950, initialStock: 2 }, true);
    const hidden = await product({}, false);

    const ok = await quote([{ productId: a, qty: 2 }, { productId: b, qty: 1 }]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.quote).toMatchObject({ ok: true, subtotalPaise: 56950, deliveryFeePaise: 0, totalPaise: 56950 });
    expect(ok.body.quote.lines[0]).toMatchObject({ productId: a, qty: 2, unitPricePaise: 22000, lineTotalPaise: 44000, problem: null });

    const bad = await quote([{ productId: a, qty: 4 }, { productId: b, qty: 3 }, { productId: hidden, qty: 1 }]);
    expect(bad.body.quote.ok).toBe(false);
    expect(bad.body.quote.lines.map((l: { problem: string; maxQty: number | null }) => [l.problem, l.maxQty])).toEqual([
      ['OVER_LIMIT', 3],
      ['NOT_ENOUGH_STOCK', 2],
      ['UNAVAILABLE', null],
    ]);
    expect(bad.body.quote.lines[2]).toMatchObject({ name: null, unitPricePaise: null });
    expect(bad.body.quote.totalPaise).toBe(0);
  }, 120_000);

  it('a quote reserves nothing and writes no stock history', async () => {
    await setFlag(true, 'internal');
    const a = await product({ initialStock: 5 }, true);
    await quote([{ productId: a, qty: 2 }]);
    const p = (await shopApi(founder).get(`/products/${a}`)).body.product;
    expect(p).toMatchObject({ stockOnHand: 5, stockReserved: 0 });
    const { count } = await supabase.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('product_id', a);
    expect(count).toBe(1); // just INITIAL_STOCK
  }, 120_000);

  it('quote input rules: same origin, JSON, sane quantities, no duplicates', async () => {
    await setFlag(true, 'internal');
    const a = await product({}, true);
    expect((await quote([{ productId: a, qty: 1 }], {})).status).toBe(403); // no Origin/Referer
    expect((await quote([{ productId: a, qty: 1 }], { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await quote([])).status).toBe(400);
    expect((await quote([{ productId: a, qty: 0 }])).status).toBe(400);
    expect((await quote([{ productId: a, qty: 21 }])).status).toBe(400);
    expect((await quote([{ productId: a, qty: 1 }, { productId: a, qty: 1 }])).status).toBe(400);
  }, 120_000);

  it('everything is 404 while the shop is off', async () => {
    const a = await product({}, true);
    await setFlag(false, 'internal');
    expect((await request(app).get(`/api/shop/products/${a}`)).status).toBe(404);
    expect((await quote([{ productId: a, qty: 1 }])).status).toBe(404);
  }, 120_000);
});
