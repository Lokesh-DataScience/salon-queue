// backend/tests/shopOrdersAdmin.test.ts — Commerce Phase 1, C5a: the founder moves orders; reminders.
// Needs step21–step24 (+ step22b) on the TESTS project and TEST_FOUNDER_* in .env.test.
// Run on its own:  npx vitest run tests/shopOrdersAdmin.test.ts
// Orders can't be deleted (by design). Orders left open are cancelled at the end; one test order ends DELIVERED.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, randomMobile } from './helpers';
import { supabase } from '../src/config/supabase';
import { listFlags } from '../src/services/flags.service';
import { supplierMessage } from '../src/services/shopOrdersAdmin.service';
import { buildShopNewOrderMessage, buildShopReminderMessage } from '../src/services/staffPush.service';
import { runShopReminders } from '../src/jobs/shopReminders.job';
import { ORIGIN, founderSession, productBody, shopApi, softDeleteProducts, throwawayAdmin } from './shopHelpers';

let founder: Awaited<ReturnType<typeof founderSession>>;
let originalFlag: { enabled: boolean; value: string };
const products: string[] = [];
const openOrders = new Set<string>();
let agent: ReturnType<typeof request.agent>;
let csrf = '';

async function setFlag(enabled: boolean) {
  await supabase.from('feature_flags').update({ enabled }).eq('key', 'shop_enabled');
  await listFlags(true);
}

async function product(stock = 10) {
  const r = await shopApi(founder).post('/products', productBody({ initialStock: stock }));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.product.id as string;
  products.push(id);
  await shopApi(founder).post(`/products/${id}/availability`, { available: true });
  return id;
}

const PHONE = randomMobile();
// Each order its own phone: a customer may have at most 2 open orders (Q7).
async function placeOrder(productId: string, qty = 2, phone = randomMobile()) {
  const r = await agent
    .post('/api/shop/orders')
    .set('Origin', ORIGIN)
    .set('X-Shop-CSRF', csrf)
    .set('Idempotency-Key', randomUUID())
    .send({
      items: [{ productId, qty }],
      expectedTotalPaise: qty * 22000,
      consent: true,
      requestSameDay: false,
      customer: { name: 'Orders Test', phone, addressLine1: '12 Test Street', addressLine2: '', landmark: '', pincode: '495001' },
    });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  openOrders.add(r.body.order.id);
  return r.body.order.id as string;
}

const move = (id: string, body: Record<string, unknown>) => shopApi(founder).post(`/orders/${id}/transition`, body);
const stockOf = async (id: string) => (await shopApi(founder).get(`/products/${id}`)).body.product as { stockOnHand: number; stockReserved: number };

beforeAll(async () => {
  founder = await founderSession();
  const { data } = await supabase.from('feature_flags').select('enabled, value').eq('key', 'shop_enabled').single();
  originalFlag = { enabled: data!.enabled, value: data!.value };
  await setFlag(true);
  agent = request.agent(app);
  const s = await agent.post('/api/shop/session').set('Origin', ORIGIN).send({});
  csrf = s.body.csrfToken;
}, 60_000);

afterAll(async () => {
  for (const id of openOrders) {
    const { data } = await supabase.from('orders').select('status').eq('id', id).single();
    if (data && !['DELIVERED', 'CANCELLED', 'OUT_FOR_DELIVERY'].includes(data.status)) {
      await move(id, { expectedFrom: data.status, to: 'CANCELLED', note: 'test cleanup' });
    }
  }
  await softDeleteProducts(founder, products);
  await supabase.from('feature_flags').update(originalFlag).eq('key', 'shop_enabled');
  await listFlags(true);
}, 60_000);

describe('admin orders: list and detail', () => {
  it('founder sees the order with customer details, costs and profit; the timeline is complete', async () => {
    const p = await product();
    const id = await placeOrder(p, 2, PHONE);
    const list = await shopApi(founder).get('/orders?status=open');
    expect(list.status).toBe(200);
    expect(list.body.orders.some((o: { id: string }) => o.id === id)).toBe(true);
    expect(list.body.counts.PLACED).toBeGreaterThanOrEqual(1);

    const d = await shopApi(founder).get(`/orders/${id}`);
    expect(d.status).toBe(200);
    expect(d.headers['cache-control']).toBe('no-store');
    expect(d.body.order).toMatchObject({ status: 'PLACED', totalPaise: 44000, customer: { phone: `+91${PHONE}`, pincode: '495001' } });
    expect(d.body.finance).toMatchObject({ costPaise: 36000, grossProfitPaise: 8000, costsConfirmed: false });
    expect(d.body.items[0]).toMatchObject({ quantity: 2, expectedUnitCostPaise: 18000, confirmedUnitCostPaise: null });
  });

  it('search by order number', async () => {
    const p = await product();
    const id = await placeOrder(p, 1);
    const num = (await shopApi(founder).get(`/orders/${id}`)).body.order.orderNumber as string;
    const r = await shopApi(founder).get(`/orders?status=all&search=${num.replace('SQ-', '')}`);
    expect(r.body.orders.map((o: { id: string }) => o.id)).toEqual([id]);
  });

  it('supplier WhatsApp text has products and quantities, never customer details or our price', async () => {
    const p = await product();
    const id = await placeOrder(p, 2, PHONE);
    const r = await shopApi(founder).get(`/orders/${id}/supplier-text`);
    expect(r.status).toBe(200);
    expect(r.body.text).toContain('× 2');
    expect(r.body.text).not.toContain(PHONE);
    expect(r.body.text).not.toContain(PHONE.slice(-10));
    expect(r.body.text).not.toContain('Orders Test');
    expect(r.body.text).not.toContain('Test Street');
    expect(r.body.text).not.toMatch(/220|₹/);
  });

  it('cofounder can read but not move; sales gets 404', async () => {
    const p = await product();
    const id = await placeOrder(p, 1);
    const co = await throwawayAdmin('COFOUNDER');
    expect((await shopApi(co).get(`/orders/${id}`)).status).toBe(200);
    const coMove = await shopApi({ ...co, csrf: 'x' }).post(`/orders/${id}/transition`, { expectedFrom: 'PLACED', to: 'SUPPLIER_PENDING' });
    expect(coMove.status).toBe(403);
    const sales = await throwawayAdmin('SALES');
    expect((await shopApi(sales).get('/orders')).status).toBe(404);
  });

  it('a move without the CSRF token or from another site is blocked', async () => {
    const p = await product();
    const id = await placeOrder(p, 1);
    const noCsrf = await shopApi({ cookie: founder.cookie, csrf: '' }).post(`/orders/${id}/transition`, { expectedFrom: 'PLACED', to: 'SUPPLIER_PENDING' });
    expect(noCsrf.status).toBe(403);
    const evil = await request(app)
      .post(`/api/admin/shop/orders/${id}/transition`)
      .set('Cookie', founder.cookie)
      .set('Origin', 'https://evil.example')
      .set('x-admin-csrf', founder.csrf)
      .send({ expectedFrom: 'PLACED', to: 'SUPPLIER_PENDING' });
    expect(evil.status).toBe(403);
  });
});

describe('admin orders: the happy path to DELIVERED', () => {
  it('PLACED → … → DELIVERED with confirmed costs, stock committed, COD recorded once', async () => {
    const p = await product(10);
    const ph = randomMobile();
    const id = await placeOrder(p, 2, ph);
    expect(await stockOf(p)).toMatchObject({ stockOnHand: 10, stockReserved: 2 });

    expect((await move(id, { expectedFrom: 'PLACED', to: 'SUPPLIER_PENDING' })).status).toBe(200);
    // double tap / stale screen
    const again = await move(id, { expectedFrom: 'PLACED', to: 'SUPPLIER_PENDING' });
    expect(again.status).toBe(409);
    expect(again.body.error ?? again.body.message).toMatch(/changed since you opened it/);

    const detail = (await shopApi(founder).get(`/orders/${id}`)).body;
    const noCosts = await move(id, { expectedFrom: 'SUPPLIER_PENDING', to: 'SUPPLIER_CONFIRMED' });
    expect(noCosts.status).toBe(400);
    const confirmed = await move(id, {
      expectedFrom: 'SUPPLIER_PENDING',
      to: 'SUPPLIER_CONFIRMED',
      lines: detail.items.map((i: { id: string }) => ({ itemId: i.id, confirmedUnitCostPaise: 17500 })),
      delivery: { date: '2026-12-01', note: 'Evening' },
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.finance).toMatchObject({ costPaise: 35000, grossProfitPaise: 9000, costsConfirmed: true });
    expect(confirmed.body.order.expectedDeliveryDate).toBe('2026-12-01');
    expect(await stockOf(p)).toMatchObject({ stockOnHand: 8, stockReserved: 0 });

    expect((await move(id, { expectedFrom: 'SUPPLIER_CONFIRMED', to: 'COLLECTED' })).status).toBe(200);
    expect((await move(id, { expectedFrom: 'COLLECTED', to: 'OUT_FOR_DELIVERY' })).status).toBe(200);
    expect((await move(id, { expectedFrom: 'OUT_FOR_DELIVERY', to: 'DELIVERY_FAILED', note: '' })).status).toBe(400);
    expect((await move(id, { expectedFrom: 'OUT_FOR_DELIVERY', to: 'DELIVERY_FAILED', note: 'Nobody home' })).status).toBe(200);
    expect((await move(id, { expectedFrom: 'DELIVERY_FAILED', to: 'OUT_FOR_DELIVERY' })).status).toBe(200);
    // DELIVERED only through the cash screen
    expect((await move(id, { expectedFrom: 'OUT_FOR_DELIVERY', to: 'DELIVERED' })).status).toBe(400);

    const cod = (b: object) => shopApi(founder).post(`/orders/${id}/cod-collection`, b);
    expect((await cod({ amountPaise: 40000 })).status).toBe(400); // different amount, no note
    const done = await cod({ amountPaise: 44000 });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.order).toMatchObject({ status: 'DELIVERED', paymentStatus: 'COLLECTED', cod: { collectedPaise: 44000 } });
    expect((await cod({ amountPaise: 44000 })).status).toBe(409); // never twice

    // the customer sees the journey (no internal events, no costs)
    const mine = await agent.get(`/api/shop/orders/${id}`);
    expect(mine.status).toBe(200);
    expect(mine.body.order.status).toBe('DELIVERED');
    expect(JSON.stringify(mine.body)).not.toMatch(/17500|confirmed_unit_cost|cod_collected/);
    expect(mine.body.order.timeline.map((e: { to: string }) => e.to)).toEqual(
      expect.arrayContaining(['SUPPLIER_PENDING', 'SUPPLIER_CONFIRMED', 'COLLECTED', 'DELIVERY_FAILED', 'DELIVERED']),
    );
    openOrders.delete(id);

    const { data: audit } = await supabase.from('admin_audit_log').select('details').eq('target_id', id);
    expect(JSON.stringify(audit)).not.toMatch(new RegExp(ph.slice(-10)));
  });
});

describe('admin orders: cancelling', () => {
  it('founder cancel needs a reason; PLACED releases the stock and the customer sees why', async () => {
    const p = await product(10);
    const id = await placeOrder(p, 3);
    expect((await move(id, { expectedFrom: 'PLACED', to: 'CANCELLED', note: '' })).status).toBe(400);
    const r = await move(id, { expectedFrom: 'PLACED', to: 'CANCELLED', note: 'Outside our delivery area' });
    expect(r.status).toBe(200);
    expect(r.body.order).toMatchObject({ status: 'CANCELLED', cancelledBy: 'FOUNDER', paymentStatus: 'VOID' });
    expect(await stockOf(p)).toMatchObject({ stockOnHand: 10, stockReserved: 0 });
    const mine = await agent.get(`/api/shop/orders/${id}`);
    expect(JSON.stringify(mine.body)).toContain('Outside our delivery area');
    openOrders.delete(id);
  });

  it('supplier has none: cancel + mark out of stock stops it being sold', async () => {
    const p = await product(5);
    const id = await placeOrder(p, 1);
    await move(id, { expectedFrom: 'PLACED', to: 'SUPPLIER_PENDING' });
    const r = await move(id, { expectedFrom: 'SUPPLIER_PENDING', to: 'CANCELLED', note: 'Supplier has none', markOutOfStock: true });
    expect(r.status).toBe(200);
    expect(await stockOf(p)).toMatchObject({ stockOnHand: 0, stockReserved: 0 });
    openOrders.delete(id);
  });

  it('cancel after collection waits for a stock decision (C6)', async () => {
    const p = await product(5);
    const id = await placeOrder(p, 1);
    await move(id, { expectedFrom: 'PLACED', to: 'SUPPLIER_PENDING' });
    const items = (await shopApi(founder).get(`/orders/${id}`)).body.items as { id: string }[];
    await move(id, { expectedFrom: 'SUPPLIER_PENDING', to: 'SUPPLIER_CONFIRMED', lines: items.map((i) => ({ itemId: i.id, confirmedUnitCostPaise: 18000 })) });
    await move(id, { expectedFrom: 'SUPPLIER_CONFIRMED', to: 'COLLECTED' });
    const r = await move(id, { expectedFrom: 'COLLECTED', to: 'CANCELLED', note: 'Customer changed their mind' });
    expect(r.status).toBe(200);
    expect(r.body.items.every((i: { stockState: string }) => i.stockState === 'AWAITING_DISPOSITION')).toBe(true);
    openOrders.delete(id);
  });
});

describe('notifications', () => {
  it('push payloads carry the order number and an admin link only', () => {
    const id = randomUUID();
    for (const m of [buildShopNewOrderMessage(id, 'SQ-1042'), buildShopReminderMessage(id, 'SQ-1042')]) {
      expect(m.title).toContain('SQ-1042');
      expect(m.url).toBe(`/barber/admin?tab=shop&view=orders&order=${id}`);
      expect(JSON.stringify(m)).not.toMatch(/\+91|₹|address/i);
    }
  });

  it('supplierMessage says "today" only when same-day was asked for', () => {
    const lines = [{ productName: 'Oil', sku: 'A', quantity: 1 }];
    expect(supplierMessage({ orderNumber: 'SQ-1', sameDayState: 'REQUESTED' }, lines)).toMatch(/today/);
    expect(supplierMessage({ orderNumber: 'SQ-1', sameDayState: 'NOT_REQUESTED' }, lines)).not.toMatch(/today/);
  });

  it('the reminder job runs, records its heartbeat and never changes an order', async () => {
    // A fresh order is not due yet (first reminder after 30 min). The "claims once" race is covered by the SQL tests.
    const p = await product();
    const id = await placeOrder(p, 1);
    await runShopReminders();
    const { data: hb } = await supabase.from('job_heartbeats').select('last_success_at').eq('name', 'shop_reminders').single();
    expect(hb?.last_success_at).toBeTruthy();
    const { data } = await supabase.from('orders').select('status, placed_reminder_count').eq('id', id).single();
    expect(data).toMatchObject({ status: 'PLACED', placed_reminder_count: 0 });
  });
});
