// backend/tests/shopAdmin.test.ts — Commerce Phase 1, C1: Shop admin (catalog, stock, settings, guards).
// Needs step21 on the TESTS project and TEST_FOUNDER_EMAIL / TEST_FOUNDER_PASSWORD in .env.test.
// Run on its own:  npx vitest run tests/shopAdmin.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';
import shopAdminRouter from '../src/routes/shopAdmin.routes';
import {
  ORIGIN,
  TINY_PNG,
  founderSession,
  productBody,
  shopApi,
  softDeleteProducts,
  throwawayAdmin,
} from './shopHelpers';

type Session = Awaited<ReturnType<typeof founderSession>>;
let founder: Session;
const created: string[] = [];

beforeAll(async () => {
  founder = await founderSession();
}, 60_000);

afterAll(async () => {
  await softDeleteProducts(founder, created);
  await cleanupSalons();
}, 120_000);

async function newProduct(overrides: Record<string, unknown> = {}) {
  const r = await shopApi(founder).post('/products', productBody(overrides));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  created.push(r.body.product.id);
  return r.body.product as { id: string; stockOnHand: number; sku: string };
}

async function movementCount(productId: string) {
  const { count, error } = await supabase
    .from('inventory_movements')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Every non-GET route registered on the shop router, with :params filled in.
function mutationRoutes(ids: { productId: string; imageId: string; categoryId: string }) {
  const out: { method: string; path: string }[] = [];
  for (const layer of (shopAdminRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack) {
    if (!layer.route) continue;
    for (const [method, on] of Object.entries(layer.route.methods)) {
      if (!on || method === 'get' || method === 'head') continue;
      const path = layer.route.path
        .replace(':productId', ids.productId)
        .replace(':imageId', ids.imageId)
        .replace(':categoryId', ids.categoryId);
      out.push({ method, path });
    }
  }
  return out;
}

describe('Shop admin — who can get in', () => {
  it('Sales, Tech and plain barbers get 404 for reads and writes', async () => {
    for (const role of ['SALES', 'TECH', null] as const) {
      const a = await throwawayAdmin(role);
      expect((await shopApi(a).get('/products')).status, String(role)).toBe(404);
      expect((await shopApi(a).post('/products', productBody())).status, String(role)).toBe(404);
    }
  }, 120_000);

  it('Cofounder reads everything, including wholesale cost and margin', async () => {
    const p = await newProduct();
    const c = await throwawayAdmin('COFOUNDER');
    const list = await shopApi(c).get('/products');
    expect(list.status).toBe(200);
    const row = list.body.products.find((x: { id: string }) => x.id === p.id);
    expect(row.wholesaleCostPaise).toBe(18000);
    expect(row.marginPaise).toBe(4000);
    for (const path of [`/products/${p.id}`, `/products/${p.id}/movements`, '/categories', '/settings']) {
      expect((await shopApi(c).get(path)).status, path).toBe(200);
    }
  }, 120_000);

  it('Cofounder gets 403 on EVERY registered write route, and nothing changes', async () => {
    const p = await newProduct();
    const img = await request(app)
      .post(`/api/admin/shop/products/${p.id}/images`)
      .set('Cookie', founder.cookie)
      .set('Origin', ORIGIN)
      .set('x-admin-csrf', founder.csrf)
      .set('Content-Type', 'image/png')
      .send(TINY_PNG);
    expect(img.status, JSON.stringify(img.body)).toBe(201);
    const imageId = img.body.product.images[0].id as string;
    const categoryId = ((await shopApi(founder).get('/categories')).body.categories[0].id) as string;

    const before = await shopApi(founder).get(`/products/${p.id}`);
    const settingsBefore = (await shopApi(founder).get('/settings')).body;
    const movementsBefore = await movementCount(p.id);

    const c = await throwawayAdmin('COFOUNDER');
    // Even with a valid-looking CSRF header and the right Origin, the role check refuses.
    const cof = { cookie: c.cookie, csrf: founder.csrf };
    const routes = mutationRoutes({ productId: p.id, imageId, categoryId });
    // 14 today (session, product create/update/delete/availability/stock, image add/update/delete,
    // stock check, category create/update, settings, supplier). A new write route is picked up automatically.
    expect(routes.length).toBeGreaterThanOrEqual(14);
    for (const r of routes) {
      const res = await (shopApi(cof) as unknown as Record<string, (p: string, b?: object) => request.Test>)[
        r.method === 'delete' ? 'del' : r.method
      ](r.path, { available: false, name: 'Changed', type: 'STOCK_COUNT', qty: 0, expectedOnHand: 10, items: [] });
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
    }

    const after = await shopApi(founder).get(`/products/${p.id}`);
    expect(after.body.product).toEqual(before.body.product);
    expect((await shopApi(founder).get('/settings')).body).toEqual(settingsBefore);
    expect(await movementCount(p.id)).toBe(movementsBefore);
  }, 180_000);

  it('the database refuses a cofounder actor even when called directly', async () => {
    const c = await throwawayAdmin('COFOUNDER');
    const { error } = await supabase.rpc('shop_update_settings', { p_actor: c.staffId, p_fields: {} });
    expect(error?.message).toBe('SHOP_FORBIDDEN');
  });
});

describe('Shop admin — request-forgery protection (§9.3)', () => {
  const body = () => productBody();
  const post = () => request(app).post('/api/admin/shop/products').set('Cookie', founder.cookie);

  it('blocks missing CSRF token, bad token, wrong Origin, no Origin/Referer, cross-site fetch, non-JSON', async () => {
    const cases: [string, request.Test][] = [
      ['no csrf', post().set('Origin', ORIGIN).send(body())],
      ['bad csrf', post().set('Origin', ORIGIN).set('x-admin-csrf', '123.abc').send(body())],
      ['wrong origin', post().set('Origin', 'https://evil.example').set('x-admin-csrf', founder.csrf).send(body())],
      ['no origin, no referer', post().set('x-admin-csrf', founder.csrf).send(body())],
      [
        'cross-site fetch',
        post().set('Origin', ORIGIN).set('Sec-Fetch-Site', 'cross-site').set('x-admin-csrf', founder.csrf).send(body()),
      ],
      [
        'form post',
        post()
          .set('Origin', ORIGIN)
          .set('x-admin-csrf', founder.csrf)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('sku=X&name=Y'),
      ],
    ];
    for (const [name, req] of cases) {
      const r = await req;
      expect(r.status, name).toBe(403);
    }
  });

  it('a CSRF token from another staff member does not work', async () => {
    const c = await throwawayAdmin('COFOUNDER');
    const { issueAdminCsrfToken } = await import('../src/middleware/shopSecurity.middleware');
    const r = await post().set('Origin', ORIGIN).set('x-admin-csrf', issueAdminCsrfToken(c.staffId).csrfToken).send(body());
    expect(r.status).toBe(403);
  });

  it('an older browser (no Fetch Metadata) with the right Origin works; Referer alone works too', async () => {
    const a = await post().set('Origin', ORIGIN).set('x-admin-csrf', founder.csrf).send(body());
    expect(a.status).toBe(201);
    created.push(a.body.product.id);
    const b = await post().set('Referer', `${ORIGIN}/barber/admin`).set('x-admin-csrf', founder.csrf).send(body());
    expect(b.status).toBe(201);
    created.push(b.body.product.id);
  });
});

describe('Shop admin — products', () => {
  it('creates hidden, with initial stock and one INITIAL_STOCK movement', async () => {
    const p = await newProduct({ initialStock: 7 });
    const r = await shopApi(founder).get(`/products/${p.id}`);
    expect(r.body.product).toMatchObject({ stockOnHand: 7, stockReserved: 0, isVisible: false, sellable: 7 });
    const m = await shopApi(founder).get(`/products/${p.id}/movements`);
    expect(m.body.movements).toHaveLength(1);
    expect(m.body.movements[0]).toMatchObject({ type: 'INITIAL_STOCK', qtyChange: 7, onHandAfter: 7 });
  });

  it('MRP is required and the selling price must be below it', async () => {
    expect((await shopApi(founder).post('/products', productBody({ mrpPaise: undefined }))).status).toBe(400);
    const eq = await shopApi(founder).post('/products', productBody({ sellingPricePaise: 25000 }));
    expect(eq.status).toBe(400);
    expect(eq.body.message).toBe('Invalid request.');
    // Changing only the price: checked against the stored MRP by the database.
    const p = await newProduct();
    const up = await shopApi(founder).patch(`/products/${p.id}`, { sellingPricePaise: 26000 });
    expect(up.status).toBe(400);
    expect(up.body.message).toBe('Selling price must be lower than MRP.');
  });

  it('warns (but allows) a selling price at or below wholesale cost', async () => {
    const p = await newProduct({ wholesaleCostPaise: 22000 });
    const r = await shopApi(founder).get(`/products/${p.id}`);
    expect(r.body.product).toMatchObject({ marginPaise: 0, marginWarning: true });
  });

  it('refuses a duplicate SKU (any letter case)', async () => {
    const p = await newProduct();
    const r = await shopApi(founder).post('/products', productBody({ sku: p.sku.toLowerCase() }));
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Another product already uses this SKU.');
  });

  it('stock fields cannot be changed through a product update', async () => {
    const p = await newProduct();
    const r = await shopApi(founder).patch(`/products/${p.id}`, { stockOnHand: 999 });
    expect(r.status).toBe(400);
  });

  it('shows/hides instantly; switching a product off also hides it', async () => {
    const p = await newProduct();
    expect((await shopApi(founder).post(`/products/${p.id}/availability`, { available: true })).body.product.isVisible).toBe(true);
    const off = await shopApi(founder).patch(`/products/${p.id}`, { isActive: false });
    expect(off.body.product).toMatchObject({ isActive: false, isVisible: false });
  });

  it('soft delete keeps history and frees the SKU', async () => {
    const p = await newProduct();
    expect((await shopApi(founder).del(`/products/${p.id}`)).status).toBe(200);
    expect((await shopApi(founder).post(`/products/${p.id}/stock`, { type: 'STOCK_COUNT', qty: 1, expectedOnHand: 10 })).status).toBe(404);
    expect(await movementCount(p.id)).toBe(1);
    const again = await newProduct({ sku: p.sku });
    expect(again.sku).toBe(p.sku);
  });
});

describe('Shop admin — stock', () => {
  it('records one movement per change, refuses stale screens and negative stock', async () => {
    const p = await newProduct({ initialStock: 10 });
    const api = shopApi(founder);
    const dmg = await api.post(`/products/${p.id}/stock`, { type: 'DAMAGED_STOCK', qty: 2, expectedOnHand: 10, reason: 'Bottle broke' });
    expect(dmg.status, JSON.stringify(dmg.body)).toBe(200);
    expect(dmg.body.product.stockOnHand).toBe(8);

    const stale = await api.post(`/products/${p.id}/stock`, { type: 'STOCK_COUNT', qty: 5, expectedOnHand: 10 });
    expect(stale.status).toBe(409);

    const neg = await api.post(`/products/${p.id}/stock`, { type: 'MANUAL_ADJUSTMENT', qty: -9, expectedOnHand: 8, reason: 'test' });
    expect(neg.status).toBe(400);

    const noReason = await api.post(`/products/${p.id}/stock`, { type: 'MANUAL_ADJUSTMENT', qty: 1, expectedOnHand: 8 });
    expect(noReason.status).toBe(400);

    const same = await api.post(`/products/${p.id}/stock`, { type: 'STOCK_COUNT', qty: 8, expectedOnHand: 8 });
    expect(same.body.product.lastStockCheckAt).not.toBeNull();
    expect(await movementCount(p.id)).toBe(2); // INITIAL_STOCK + DAMAGED_STOCK; an unchanged count adds none
  });

  it('two simultaneous changes from the same screen: exactly one wins', async () => {
    const p = await newProduct({ initialStock: 10 });
    const api = shopApi(founder);
    const [a, b] = await Promise.all([
      api.post(`/products/${p.id}/stock`, { type: 'MANUAL_ADJUSTMENT', qty: 1, expectedOnHand: 10, reason: 'race a' }),
      api.post(`/products/${p.id}/stock`, { type: 'MANUAL_ADJUSTMENT', qty: 1, expectedOnHand: 10, reason: 'race b' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await api.get(`/products/${p.id}`)).body.product.stockOnHand).toBe(11);
    expect(await movementCount(p.id)).toBe(2);
  });

  it('daily stock check is all-or-nothing', async () => {
    const a = await newProduct({ initialStock: 5 });
    const b = await newProduct({ initialStock: 3 });
    const api = shopApi(founder);
    const bad = await api.post('/stock/check', {
      items: [
        { productId: a.id, counted: 4, expectedOnHand: 5 },
        { productId: b.id, counted: 3, expectedOnHand: 99 },
      ],
    });
    expect(bad.status).toBe(409);
    expect((await api.get(`/products/${a.id}`)).body.product.stockOnHand).toBe(5);

    const ok = await api.post('/stock/check', {
      items: [
        { productId: a.id, counted: 4, expectedOnHand: 5 },
        { productId: b.id, counted: 3, expectedOnHand: 3 },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ checked: 2, changed: 1 });
  });

  it('stock history cannot be edited or deleted, even with the service key', async () => {
    const p = await newProduct();
    const upd = await supabase.from('inventory_movements').update({ reason: 'x' }).eq('product_id', p.id);
    expect(upd.error?.message).toBe('SHOP_HISTORY_IMMUTABLE');
    const del = await supabase.from('inventory_movements').delete().eq('product_id', p.id);
    expect(del.error?.message).toBe('SHOP_HISTORY_IMMUTABLE');
    const direct = await supabase.from('products').update({ stock_on_hand: 999 }).eq('id', p.id);
    expect(direct.error?.message).toBe('SHOP_STOCK_VIA_FUNCTION');
  });
});

describe('Shop admin — photos', () => {
  const upload = (productId: string, type: string, body: Buffer) =>
    request(app)
      .post(`/api/admin/shop/products/${productId}/images?alt=front`)
      .set('Cookie', founder.cookie)
      .set('Origin', ORIGIN)
      .set('x-admin-csrf', founder.csrf)
      .set('Content-Type', type)
      .send(body);

  it('uploads a real image, serves a public URL, and deletes it', async () => {
    const p = await newProduct();
    const up = await upload(p.id, 'image/png', TINY_PNG);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const img = up.body.product.images[0];
    expect(img.url).toContain('/storage/v1/object/public/shop-product-images/products/');
    expect(img.alt).toBe('front');
    const del = await shopApi(founder).del(`/products/${p.id}/images/${img.id}`);
    expect(del.status).toBe(200);
    expect(del.body.product.images).toHaveLength(0);
  }, 60_000);

  it('refuses a file that is not really an image', async () => {
    const p = await newProduct();
    const r = await upload(p.id, 'image/png', Buffer.from('<script>alert(1)</script>'));
    expect(r.status).toBe(400);
  });
});

describe('Shop admin — settings and supplier', () => {
  it('founder saves settings (and they are restored)', async () => {
    const api = shopApi(founder);
    const before = (await api.get('/settings')).body.settings;
    const r = await api.patch('/settings', { sameDayCutoff: '14:30', placedReminderAfterMinutes: 45 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.settings).toMatchObject({ sameDayCutoff: '14:30', placedReminderAfterMinutes: 45 });
    expect((await api.patch('/settings', { sameDayCutoff: '25:00' })).status).toBe(400);
    await api.patch('/settings', {
      sameDayCutoff: before.sameDayCutoff,
      placedReminderAfterMinutes: before.placedReminderAfterMinutes,
    });
  });

  it('founder edits the supplier (and it is restored)', async () => {
    const api = shopApi(founder);
    const before = (await api.get('/settings')).body.supplier;
    const r = await api.patch('/supplier', { notes: 'test note' });
    expect(r.body.supplier.notes).toBe('test note');
    await api.patch('/supplier', { notes: before.notes });
  });
});

describe('Delete salon with shop history (D19)', () => {
  it('is refused with a clear message and no "deleted" audit row', async () => {
    // One fixed internal salon whose staff member has stock history. It can never be deleted (by design),
    // so it is reused on every run instead of creating a new one each time.
    const NAME = 'TEST shop-history salon (kept by design)';
    let { data: salon } = await supabase.from('salons').select('id').eq('name', NAME).maybeSingle();
    if (!salon) {
      const ins = await supabase
        .from('salons')
        .insert({ name: NAME, phone: '0000000000', address: 'Test Street', opening_time: '00:00', closing_time: '23:59', is_internal: true })
        .select('id')
        .single();
      if (ins.error) throw new Error(ins.error.message);
      salon = ins.data;
    }
    const salonId = salon!.id as string;
    let { data: staff } = await supabase.from('salon_staff').select('id').eq('salon_id', salonId).limit(1).maybeSingle();
    if (!staff) {
      const ins = await supabase
        .from('salon_staff')
        .insert({ salon_id: salonId, name: 'History Keeper', email: `history-${salonId}@example.test`, password_hash: 'x', role: 'OWNER' })
        .select('id')
        .single();
      if (ins.error) throw new Error(ins.error.message);
      staff = ins.data;
    }
    const staffId = staff!.id as string;
    const { count } = await supabase
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .eq('actor_staff_id', staffId);
    if (!count) {
      // Give this staff member stock history: briefly FOUNDER, one stock change, role removed again.
      const p = await newProduct({ initialStock: 1 });
      await supabase.from('staff_admin_roles').upsert({ staff_id: staffId, role: 'FOUNDER' });
      const { error } = await supabase.rpc('shop_adjust_stock', {
        p_actor: staffId, p_product_id: p.id, p_type: 'MANUAL_ADJUSTMENT', p_qty: 1, p_expected_on_hand: 1, p_reason: 'history',
      });
      await supabase.from('staff_admin_roles').delete().eq('staff_id', staffId);
      if (error) throw new Error(error.message);
    }

    const { count: auditBefore } = await supabase
      .from('admin_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'salon.delete')
      .eq('target_id', salonId);

    const r = await request(app)
      .delete(`/api/admin/founder/salons/${salonId}`)
      .set('Cookie', founder.cookie)
      .send({ confirmName: NAME });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('shop history');

    const { data: still } = await supabase.from('salons').select('id').eq('id', salonId).maybeSingle();
    expect(still).not.toBeNull();
    const { count: auditAfter } = await supabase
      .from('admin_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'salon.delete')
      .eq('target_id', salonId);
    expect(auditAfter).toBe(auditBefore);
  }, 60_000);
});
