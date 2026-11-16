// backend/tests/shopCheckout.test.ts — Commerce Phase 1, C4a: customer session, COD checkout, orders, cancel.
// Needs step21–step23 on the TESTS project and TEST_FOUNDER_* in .env.test.
// Run on its own:  npx vitest run tests/shopCheckout.test.ts
// Test orders can't be deleted (by design); every order made here is cancelled at the end, releasing its stock.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, randomMobile } from './helpers';
import { supabase } from '../src/config/supabase';
import { listFlags } from '../src/services/flags.service';
import { SHOP_ACCESS_COOKIE } from '../src/services/shopCustomer.service';
import { ORIGIN, founderSession, productBody, shopApi, softDeleteProducts } from './shopHelpers';

type Founder = Awaited<ReturnType<typeof founderSession>>;
let founder: Founder;
let originalFlag: { enabled: boolean; value: string };
const products: string[] = [];
const devices: Device[] = [];

async function setFlag(enabled: boolean) {
  await supabase.from('feature_flags').update({ enabled }).eq('key', 'shop_enabled');
  await listFlags(true);
}

async function product(overrides: Record<string, unknown> = {}) {
  const r = await shopApi(founder).post('/products', productBody({ initialStock: 10, ...overrides }));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.product.id as string;
  products.push(id);
  await shopApi(founder).post(`/products/${id}/availability`, { available: true });
  return id;
}

// One phone/browser: a supertest agent keeps its cookie jar.
interface Device {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  orders: string[];
}
async function device(): Promise<Device> {
  const agent = request.agent(app);
  const r = await agent.post('/api/shop/session').set('Origin', ORIGIN).send({});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const d = { agent, csrf: r.body.csrfToken as string, orders: [] as string[] };
  devices.push(d);
  return d;
}

const customer = (o: Record<string, unknown> = {}) => ({
  name: 'Test Customer',
  phone: randomMobile(),
  addressLine1: '12 Test Street',
  addressLine2: '',
  landmark: 'near the test temple',
  pincode: '495001',
  ...o,
});

function checkout(d: Device, body: Record<string, unknown>, key = randomUUID()) {
  return d.agent
    .post('/api/shop/orders')
    .set('Origin', ORIGIN)
    .set('X-Shop-CSRF', d.csrf)
    .set('Idempotency-Key', key)
    .send({ consent: true, requestSameDay: false, ...body });
}

async function order(d: Device, productId: string, qty: number, unitPaise: number, cust = customer(), key = randomUUID()) {
  const r = await checkout(d, { items: [{ productId, qty }], expectedTotalPaise: qty * unitPaise, customer: cust }, key);
  if (r.body.order?.id) d.orders.push(r.body.order.id);
  return r;
}

const stock = async (id: string) => (await shopApi(founder).get(`/products/${id}`)).body.product as { stockOnHand: number; stockReserved: number };

beforeAll(async () => {
  founder = await founderSession();
  const { data } = await supabase.from('feature_flags').select('enabled, value').eq('key', 'shop_enabled').single();
  originalFlag = { enabled: data!.enabled, value: data!.value };
  await setFlag(true);
}, 60_000);

afterAll(async () => {
  for (const d of devices) {
    for (const id of d.orders) {
      await d.agent.post(`/api/shop/orders/${id}/cancel`).set('Origin', ORIGIN).set('X-Shop-CSRF', d.csrf).send({ reason: 'test cleanup' });
    }
  }
  await supabase.from('feature_flags').update(originalFlag).eq('key', 'shop_enabled');
  await listFlags(true);
  await softDeleteProducts(founder, products);
}, 180_000);

describe('Customer session (§9.1–9.2)', () => {
  it('sets an HttpOnly device cookie (only its hash is stored) and returns a CSRF token', async () => {
    const agent = request.agent(app);
    const r = await agent.post('/api/shop/session').set('Origin', ORIGIN).send({});
    expect(r.status).toBe(200);
    expect(r.body.csrfToken).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${SHOP_ACCESS_COOKIE}=`))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    const raw = cookie.split(';')[0].split('=')[1];
    const { count } = await supabase.from('shop_access_keys').select('id', { count: 'exact', head: true }).eq('key_hash', raw);
    expect(count).toBe(0); // the raw value is never stored

    // Same device again: no new cookie.
    const again = await agent.post('/api/shop/session').set('Origin', ORIGIN).send({});
    expect(again.status).toBe(200);
    expect(([] as string[]).concat(again.headers['set-cookie'] ?? []).some((c) => c.startsWith(`${SHOP_ACCESS_COOKIE}=`))).toBe(false);
  });

  it('refuses a cross-site or origin-less session request', async () => {
    expect((await request(app).post('/api/shop/session').send({})).status).toBe(403);
    expect((await request(app).post('/api/shop/session').set('Origin', 'https://evil.example').send({})).status).toBe(403);
  });

  it('checkout without a cookie, a CSRF token, the right origin or JSON is blocked', async () => {
    const p = await product();
    const d = await device();
    const body = { items: [{ productId: p, qty: 1 }], expectedTotalPaise: 22000, customer: customer(), consent: true };
    const noCookie = await request(app).post('/api/shop/orders').set('Origin', ORIGIN).set('X-Shop-CSRF', d.csrf).set('Idempotency-Key', randomUUID()).send(body);
    expect(noCookie.status).toBe(403);
    const noCsrf = await d.agent.post('/api/shop/orders').set('Origin', ORIGIN).set('Idempotency-Key', randomUUID()).send(body);
    expect(noCsrf.status).toBe(403);
    const otherDevice = await device();
    const wrongToken = await d.agent.post('/api/shop/orders').set('Origin', ORIGIN).set('X-Shop-CSRF', otherDevice.csrf).set('Idempotency-Key', randomUUID()).send(body);
    expect(wrongToken.status).toBe(403);
    const crossSite = await d.agent.post('/api/shop/orders').set('Origin', ORIGIN).set('Sec-Fetch-Site', 'cross-site').set('X-Shop-CSRF', d.csrf).set('Idempotency-Key', randomUUID()).send(body);
    expect(crossSite.status).toBe(403);
    const form = await d.agent.post('/api/shop/orders').set('Origin', ORIGIN).set('X-Shop-CSRF', d.csrf).set('Idempotency-Key', randomUUID()).type('form').send('a=1');
    expect(form.status).toBe(403);
    expect((await stock(p)).stockReserved).toBe(0);
  }, 120_000);
});

describe('COD checkout (§8.2)', () => {
  it('places an order: stock reserved, server totals, snapshot, visible to this device only', async () => {
    const p = await product({ mrpPaise: 25000, sellingPricePaise: 22000 });
    const d = await device();
    const cust = customer({ name: 'Ravi Test' });
    const r = await order(d, p, 2, 22000, cust);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.order.orderNumber).toMatch(/^SQ-\d{4,}$/);
    expect(await stock(p)).toMatchObject({ stockOnHand: 10, stockReserved: 2 });

    const list = await d.agent.get('/api/shop/orders');
    expect(list.body.orders.map((o: { id: string }) => o.id)).toContain(r.body.order.id);

    const detail = await d.agent.get(`/api/shop/orders/${r.body.order.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.order).toMatchObject({
      status: 'PLACED',
      paymentMethod: 'COD',
      paymentStatus: 'COD_PENDING',
      totalPaise: 44000,
      deliveryFeePaise: 0,
      canCancel: true,
      delivery: { name: 'Ravi Test', phone: `+91${cust.phone}` },
    });
    expect(detail.body.order.items).toEqual([expect.objectContaining({ qty: 2, unitPricePaise: 22000, lineTotalPaise: 44000 })]);
    expect(detail.body.order.timeline.map((e: { type: string }) => e.type)).toEqual(['placed']);
    expect(JSON.stringify(detail.body).toLowerCase()).not.toMatch(/wholesale|cost|sku|request_hash|profile|customer_id|margin/);

    // Another phone: the order doesn't exist for it, even with the id.
    const stranger = await device();
    expect((await stranger.agent.get(`/api/shop/orders/${r.body.order.id}`)).status).toBe(404);
    expect((await stranger.agent.get('/api/shop/orders')).body.orders).toEqual([]);
    const strangerCancel = await stranger.agent.post(`/api/shop/orders/${r.body.order.id}/cancel`).set('Origin', ORIGIN).set('X-Shop-CSRF', stranger.csrf).send({});
    expect(strangerCancel.status).toBe(404);
    expect((await request(app).get(`/api/shop/orders/${r.body.order.id}`)).status).toBe(404); // no cookie at all
  }, 120_000);

  it('a lost response retried with the same key returns the original order; a changed request is refused', async () => {
    const p = await product();
    const d = await device();
    const cust = customer();
    const key = randomUUID();
    const first = await order(d, p, 1, 22000, cust, key);
    expect(first.status).toBe(201);
    const retry = await order(d, p, 1, 22000, cust, key);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ existing: true, order: { id: first.body.order.id } });
    const changed = await order(d, p, 1, 22000, { ...cust, landmark: 'different' }, key);
    expect(changed.status).toBe(422);
    expect(changed.body.code).toBe('IDEMPOTENCY_MISMATCH');
    expect((await stock(p)).stockReserved).toBe(1);
  }, 120_000);

  it('the same key sent 5 times at once makes one order', async () => {
    const p = await product();
    const d = await device();
    const cust = customer();
    const key = randomUUID();
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => order(d, p, 1, 22000, cust, key)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(rs.map((r) => r.body.order.id)).size).toBe(1);
    d.orders = [rs[0].body.order.id];
    expect((await stock(p)).stockReserved).toBe(1);
  }, 120_000);

  it('10 people ordering the last 3 units at once: at most 3 succeed', async () => {
    const p = await product({ initialStock: 3 });
    const ds = await Promise.all(Array.from({ length: 10 }, () => device()));
    const rs = await Promise.all(ds.map((d) => order(d, p, 1, 22000)));
    const ok = rs.filter((r) => r.status === 201);
    expect(ok.length).toBeLessThanOrEqual(3);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(rs.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
    const s = await stock(p);
    expect(s.stockReserved).toBe(ok.length);
    expect(s.stockReserved).toBeLessThanOrEqual(s.stockOnHand);
  }, 180_000);

  it('a changed price is refused with the new quote; nothing is written', async () => {
    const p = await product({ mrpPaise: 25000, sellingPricePaise: 22000 });
    const d = await device();
    const r = await order(d, p, 1, 20000); // the customer saw ₹200, the server says ₹220
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PRICE_CHANGED');
    expect(r.body.quote.totalPaise).toBe(22000);
    expect((await stock(p)).stockReserved).toBe(0);
  }, 120_000);

  it('cart problems (over the per-order limit) are refused with the quote', async () => {
    const p = await product({ maxPerOrder: 2 });
    const d = await device();
    const r = await order(d, p, 3, 22000);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CART_PROBLEM');
    expect(r.body.quote.lines[0]).toMatchObject({ problem: 'OVER_LIMIT', maxQty: 2 });
  }, 120_000);

  it('input rules: consent, phone, key', async () => {
    const p = await product();
    const d = await device();
    const base = { items: [{ productId: p, qty: 1 }], expectedTotalPaise: 22000, customer: customer() };
    expect((await checkout(d, { ...base, consent: false })).status).toBe(400);
    expect((await checkout(d, { ...base, customer: customer({ phone: '12345' }) })).status).toBe(400);
    expect((await checkout(d, { ...base, customer: customer({ pincode: '12' }) })).status).toBe(400);
    const noKey = await d.agent.post('/api/shop/orders').set('Origin', ORIGIN).set('X-Shop-CSRF', d.csrf).send({ ...base, consent: true });
    expect(noKey.status).toBe(400);
  }, 120_000);

  it('open orders per customer are limited (Q7: 2)', async () => {
    const p = await product();
    const d = await device();
    const cust = customer();
    expect((await order(d, p, 1, 22000, cust)).status).toBe(201);
    expect((await order(d, p, 1, 22000, cust)).status).toBe(201);
    const third = await order(d, p, 1, 22000, cust);
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('TOO_MANY_OPEN_ORDERS');
  }, 120_000);

  it('an existing customer record is never changed by a checkout (D22); each order keeps its own details', async () => {
    const p = await product();
    const phone = randomMobile();
    const a = await device();
    const b = await device();
    await order(a, p, 1, 22000, customer({ phone, name: 'First Name', addressLine1: 'First street' }));
    const second = await order(b, p, 1, 22000, customer({ phone, name: 'Someone Else', addressLine1: 'Other street' }));
    expect(second.status).toBe(201);
    const { data: c } = await supabase.from('shop_customers').select('display_name, address_line1').eq('phone_e164', `+91${phone}`).single();
    expect(c).toEqual({ display_name: 'First Name', address_line1: 'First street' });
    const detail = await b.agent.get(`/api/shop/orders/${second.body.order.id}`);
    expect(detail.body.order.delivery.name).toBe('Someone Else');
    // and the first device still doesn't see the second device's order
    expect((await a.agent.get(`/api/shop/orders/${second.body.order.id}`)).status).toBe(404);
  }, 120_000);

  it('prefill comes from this device\'s own last order only', async () => {
    const p = await product();
    const d = await device();
    expect((await d.agent.get('/api/shop/prefill')).body.prefill).toBeNull();
    const cust = customer({ name: 'Prefill Person' });
    await order(d, p, 1, 22000, cust);
    expect((await d.agent.get('/api/shop/prefill')).body.prefill).toMatchObject({ name: 'Prefill Person', phone: `+91${cust.phone}` });
    const other = await device();
    expect((await other.agent.get('/api/shop/prefill')).body.prefill).toBeNull();
  }, 120_000);
});

describe('Customer cancel (D8)', () => {
  it('cancels a placed order, releases the stock, and cannot cancel twice', async () => {
    const p = await product();
    const d = await device();
    const r = await order(d, p, 2, 22000);
    const id = r.body.order.id as string;
    const c = await d.agent.post(`/api/shop/orders/${id}/cancel`).set('Origin', ORIGIN).set('X-Shop-CSRF', d.csrf).send({ reason: 'Ordered by mistake' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'VOID', canCancel: false, cancelledBy: 'CUSTOMER' });
    expect(c.body.order.timeline.map((e: { type: string }) => e.type)).toEqual(['placed', 'cancelled']);
    expect((await stock(p)).stockReserved).toBe(0);
    const again = await d.agent.post(`/api/shop/orders/${id}/cancel`).set('Origin', ORIGIN).set('X-Shop-CSRF', d.csrf).send({});
    expect(again.status).toBe(409);
    d.orders = d.orders.filter((x) => x !== id);
  }, 120_000);
});

describe('Shop switched off', () => {
  it('session, checkout and orders are all 404', async () => {
    const d = await device();
    await setFlag(false);
    try {
      expect((await d.agent.post('/api/shop/session').set('Origin', ORIGIN).send({})).status).toBe(404);
      expect((await d.agent.get('/api/shop/orders')).status).toBe(404);
    } finally {
      await setFlag(true);
    }
  });
});

describe('Device linking (C4b, §9.4)', () => {
  const post = (d: Device, path: string, body: object) =>
    d.agent.post(`/api/shop${path}`).set('Origin', ORIGIN).set('X-Shop-CSRF', d.csrf).send(body);

  it('a code from the old phone lets the new phone see the same orders; the code works once', async () => {
    const p = await product();
    const oldPhone = await device();
    const placed = await order(oldPhone, p, 1, 22000);
    const code = await post(oldPhone, '/device-link/code', {});
    expect(code.status, JSON.stringify(code.body)).toBe(200);
    expect(code.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const newPhone = await device();
    const r = await post(newPhone, '/device-link/redeem', { code: code.body.code.toLowerCase().replace('-', ' ') });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.linked).toBe(true);
    newPhone.csrf = r.body.csrfToken; // bound to its new key

    const list = await newPhone.agent.get('/api/shop/orders');
    expect(list.body.orders.map((o: { id: string }) => o.id)).toContain(placed.body.order.id);
    expect((await newPhone.agent.get(`/api/shop/orders/${placed.body.order.id}`)).status).toBe(200);

    const third = await device();
    const again = await post(third, '/device-link/redeem', { code: code.body.code });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('INVALID_CODE');
    expect((await third.agent.get(`/api/shop/orders/${placed.body.order.id}`)).status).toBe(404);
  }, 120_000);

  it('a phone with its own orders is not linked over (none of its orders would disappear)', async () => {
    const p = await product();
    const a = await device();
    const b = await device();
    await order(b, p, 1, 22000);
    const code = await post(a, '/device-link/code', {});
    const r = await post(b, '/device-link/redeem', { code: code.body.code });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('HAS_OWN_ORDERS');
  }, 120_000);

  it('wrong codes and codes without CSRF are refused', async () => {
    const d = await device();
    expect((await post(d, '/device-link/redeem', { code: 'ABCD-EFGH' })).status).toBe(400);
    const noCsrf = await d.agent.post('/api/shop/device-link/code').set('Origin', ORIGIN).send({});
    expect(noCsrf.status).toBe(403);
  });
});

describe('Saved details (C4b, §10)', () => {
  const post = (d: Device, path: string, body: object) =>
    d.agent.post(`/api/shop${path}`).set('Origin', ORIGIN).set('X-Shop-CSRF', d.csrf).send(body);

  it('an unverified phone cannot change saved details', async () => {
    const p = await product();
    const d = await device();
    await order(d, p, 1, 22000);
    const r = await post(d, '/details', { name: 'Changed', addressLine1: 'Changed street' });
    expect(r.status).toBe(403);
    expect((await d.agent.get('/api/shop/prefill')).body).toMatchObject({ verified: false, prefill: { source: 'last_order' } });
  }, 120_000);

  it('a verified phone prefills from the saved record and can change it; an audit row lists the fields', async () => {
    const p = await product();
    const d = await device();
    const cust = customer({ name: 'Verified Person', addressLine1: 'Old street 1' });
    await order(d, p, 1, 22000, cust);
    // Stand-in for the founder callback (C5): mark this phone verified for its customer.
    const { data: c } = await supabase.from('shop_customers').select('id').eq('phone_e164', `+91${cust.phone}`).single();
    const { data: key } = await supabase.from('orders').select('placed_by_profile_id').eq('id', d.orders[0]).single();
    await supabase.from('shop_profile_customers').insert({
      profile_id: key!.placed_by_profile_id, customer_id: c!.id, method: 'FOUNDER_CALLBACK', verified_by_staff_id: founder.staffId,
    });

    const pre = await d.agent.get('/api/shop/prefill');
    expect(pre.body).toMatchObject({ verified: true, prefill: { source: 'saved', name: 'Verified Person', addressLine1: 'Old street 1' } });

    const r = await post(d, '/details', { name: 'Verified Person', addressLine1: 'New street 2', landmark: 'water tank' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.changed).toEqual(['address_line1', 'landmark']);
    const { data: after } = await supabase.from('shop_customers').select('address_line1, landmark').eq('id', c!.id).single();
    expect(after).toEqual({ address_line1: 'New street 2', landmark: 'water tank' });
    const { data: ev } = await supabase.from('shop_customer_events').select('fields').eq('customer_id', c!.id);
    expect(ev).toEqual([{ fields: ['address_line1', 'landmark'] }]);
    // the earlier order keeps the details it was placed with
    expect((await d.agent.get(`/api/shop/orders/${d.orders[0]}`)).body.order.delivery.addressLine1).toBe('Old street 1');
  }, 120_000);
});
