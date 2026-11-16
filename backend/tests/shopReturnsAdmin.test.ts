// backend/tests/shopReturnsAdmin.test.ts — Commerce Phase 1, C6: stock decisions, returns, refunds.
// Needs step21–step25 (+ step22b) on the TESTS project and TEST_FOUNDER_* in .env.test.
// Run on its own:  npx vitest run tests/shopReturnsAdmin.test.ts
// Returns and decisions are permanent history (by design): they stay on the tests project.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, randomMobile } from './helpers';
import { supabase } from '../src/config/supabase';
import { listFlags } from '../src/services/flags.service';
import { ORIGIN, founderSession, productBody, shopApi, softDeleteProducts, throwawayAdmin } from './shopHelpers';

let founder: Awaited<ReturnType<typeof founderSession>>;
let originalFlag: { enabled: boolean; value: string };
const products: string[] = [];
let agent: ReturnType<typeof request.agent>;
let csrf = '';

async function product(stock = 20) {
  const r = await shopApi(founder).post('/products', productBody({ initialStock: stock }));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  products.push(r.body.product.id);
  await shopApi(founder).post(`/products/${r.body.product.id}/availability`, { available: true });
  return r.body.product.id as string;
}
const stockOf = async (id: string) => (await shopApi(founder).get(`/products/${id}`)).body.product.stockOnHand as number;

async function placeOrder(productId: string, qty: number) {
  const r = await agent
    .post('/api/shop/orders')
    .set('Origin', ORIGIN)
    .set('X-Shop-CSRF', csrf)
    .set('Idempotency-Key', randomUUID())
    .send({
      items: [{ productId, qty }],
      expectedTotalPaise: qty * 22000,
      consent: true,
      customer: { name: 'Returns Test', phone: randomMobile(), addressLine1: '3 Test Road', addressLine2: '', landmark: '', pincode: '' },
    });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.order.id as string;
}
const move = (id: string, body: Record<string, unknown>) => shopApi(founder).post(`/orders/${id}/transition`, body);
const detail = async (id: string) => (await shopApi(founder).get(`/orders/${id}`)).body;

async function toCollected(id: string) {
  await move(id, { expectedFrom: 'PLACED', to: 'SUPPLIER_PENDING' });
  const items = (await detail(id)).items as { id: string }[];
  await move(id, { expectedFrom: 'SUPPLIER_PENDING', to: 'SUPPLIER_CONFIRMED', lines: items.map((i) => ({ itemId: i.id, confirmedUnitCostPaise: 17500 })) });
  await move(id, { expectedFrom: 'SUPPLIER_CONFIRMED', to: 'COLLECTED' });
}
async function deliver(id: string) {
  await toCollected(id);
  await move(id, { expectedFrom: 'COLLECTED', to: 'OUT_FOR_DELIVERY' });
  const r = await shopApi(founder).post(`/orders/${id}/cod-collection`, { amountPaise: (await detail(id)).order.totalPaise });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

beforeAll(async () => {
  founder = await founderSession();
  const { data } = await supabase.from('feature_flags').select('enabled, value').eq('key', 'shop_enabled').single();
  originalFlag = { enabled: data!.enabled, value: data!.value };
  await supabase.from('feature_flags').update({ enabled: true }).eq('key', 'shop_enabled');
  await listFlags(true);
  agent = request.agent(app);
  csrf = (await agent.post('/api/shop/session').set('Origin', ORIGIN).send({})).body.csrfToken;
}, 60_000);

afterAll(async () => {
  await softDeleteProducts(founder, products);
  await supabase.from('feature_flags').update(originalFlag).eq('key', 'shop_enabled');
  await listFlags(true);
}, 60_000);

describe('refused at the door: stock decision', () => {
  it('needs attention; 2 back to supplier + 1 written off; stock and supplier bill follow', async () => {
    const p = await product(20);
    const id = await placeOrder(p, 3);
    await toCollected(id);
    expect(await stockOf(p)).toBe(17);
    await move(id, { expectedFrom: 'COLLECTED', to: 'CANCELLED', note: 'Customer refused at the door' });

    const list = await shopApi(founder).get('/orders?status=attention');
    expect(list.body.attention.stockDecisions).toBeGreaterThanOrEqual(1);
    const row = list.body.orders.find((o: { id: string }) => o.id === id);
    expect(row.needs).toBe('STOCK_DECISION');

    const lineId = (await detail(id)).items[0].id as string;
    const bad = await shopApi(founder).post(`/orders/${id}/lines/${lineId}/disposition`, { backToSupplierQty: 2, writeOffQty: 0 });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/add up/);
    const ok = await shopApi(founder).post(`/orders/${id}/lines/${lineId}/disposition`, { backToSupplierQty: 2, writeOffQty: 1, note: 'One box opened' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.items[0]).toMatchObject({ stockState: 'CANCEL_SPLIT', cancelRestockQty: 2, cancelWriteOffQty: 1, keptUnits: 1 });
    expect(ok.body.finance).toMatchObject({ costPaise: 17500, netProfitPaise: -17500 });
    expect(await stockOf(p)).toBe(19);
    expect((await shopApi(founder).post(`/orders/${id}/lines/${lineId}/disposition`, { backToSupplierQty: 3, writeOffQty: 0 })).status).toBe(409);

    // the written-off unit is owed to the supplier
    const pending = await shopApi(founder).get('/settlements/pending');
    const owed = pending.body.orders.find((o: { id: string }) => o.id === id);
    expect(owed).toMatchObject({ status: 'CANCELLED', payablePaise: 17500 });
  });
});

describe('returns after delivery', () => {
  it('partial returns, refund limits, refund paid separately; the customer sees each step', async () => {
    const p = await product(20);
    const id = await placeOrder(p, 2);
    await deliver(id);
    expect(await stockOf(p)).toBe(18);
    const lineId = (await detail(id)).items[0].id as string;
    const ret = (qty: number, reason: string) => shopApi(founder).post(`/orders/${id}/lines/${lineId}/returns`, { quantity: qty, reason });

    expect((await ret(3, 'too many')).status).toBe(400);
    const first = await ret(1, 'Wrong shade');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.items[0].returnedQty).toBe(1);
    expect(await stockOf(p)).toBe(18); // nothing moves until decided
    const r1 = first.body.returns[0].id as string;

    const tooHigh = await shopApi(founder).post(`/returns/${r1}/resolve`, { decision: 'RESOLVED', backToSupplierQty: 1, refundPaise: 22001 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.message).toMatch(/refund is too high/);
    const resolved = await shopApi(founder).post(`/returns/${r1}/resolve`, { decision: 'RESOLVED', backToSupplierQty: 1, refundPaise: 22000, note: 'Unopened' });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(resolved.body.order.paymentStatus).toBe('REFUND_PENDING');
    expect(resolved.body.finance).toMatchObject({ costPaise: 17500, refundPendingPaise: 22000 });
    expect(await stockOf(p)).toBe(19);
    expect((await shopApi(founder).post(`/returns/${r1}/resolve`, { decision: 'RESOLVED', backToSupplierQty: 1 })).status).toBe(409);

    // the same return resolved twice at the same moment: one wins
    const second = await ret(1, 'Leaking');
    const r2 = second.body.returns[1].id as string;
    const both = await Promise.all([1, 2].map(() => shopApi(founder).post(`/returns/${r2}/resolve`, { decision: 'RESOLVED', writeOffQty: 1, refundPaise: 22000 })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stockOf(p)).toBe(19); // written off: no stock

    const paid = await shopApi(founder).post(`/returns/${r1}/refund-paid`, { method: 'UPI' });
    expect(paid.status).toBe(200);
    expect(paid.body.order.paymentStatus).toBe('REFUND_PENDING'); // r2 still waiting
    const paid2 = await shopApi(founder).post(`/returns/${r2}/refund-paid`, { method: 'CASH' });
    expect(paid2.body.order.paymentStatus).toBe('REFUNDED');
    expect((await shopApi(founder).post(`/returns/${r2}/refund-paid`, { method: 'CASH' })).status).toBe(409);

    const mine = await agent.get(`/api/shop/orders/${id}`);
    const types = mine.body.order.timeline.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['return_received', 'return_resolved', 'refund_paid']));
    expect(JSON.stringify(mine.body)).not.toMatch(/17500|written|Unopened/i);
  });

  it('a rejected return gives the units back to the customer; nothing moves', async () => {
    const p = await product(20);
    const id = await placeOrder(p, 1);
    await deliver(id);
    const lineId = (await detail(id)).items[0].id as string;
    const r = await shopApi(founder).post(`/orders/${id}/lines/${lineId}/returns`, { quantity: 1, reason: 'Changed mind' });
    const rid = r.body.returns[0].id as string;
    expect((await shopApi(founder).post(`/returns/${rid}/resolve`, { decision: 'REJECTED' })).status).toBe(400);
    const rej = await shopApi(founder).post(`/returns/${rid}/resolve`, { decision: 'REJECTED', note: 'Opened and used' });
    expect(rej.status).toBe(200);
    expect(rej.body.items[0].returnedQty).toBe(0);
    expect(rej.body.order.paymentStatus).toBe('COLLECTED');
  });

  it('returns only on delivered orders', async () => {
    const p = await product(20);
    const id = await placeOrder(p, 1);
    const lineId = (await detail(id)).items[0].id as string;
    expect((await shopApi(founder).post(`/orders/${id}/lines/${lineId}/returns`, { quantity: 1, reason: 'early' })).status).toBe(409);
    await move(id, { expectedFrom: 'PLACED', to: 'CANCELLED', note: 'test cleanup' });
  });
});

describe('permissions', () => {
  it('cofounder cannot decide, record returns or refunds; sales gets 404', async () => {
    const co = await throwawayAdmin('COFOUNDER');
    const writes = [
      [`/orders/${randomUUID()}/lines/${randomUUID()}/disposition`, { backToSupplierQty: 1, writeOffQty: 0 }],
      [`/orders/${randomUUID()}/lines/${randomUUID()}/returns`, { quantity: 1, reason: 'xxx' }],
      [`/returns/${randomUUID()}/resolve`, { decision: 'REJECTED', note: 'xxx' }],
      [`/returns/${randomUUID()}/refund-paid`, { method: 'CASH' }],
    ] as const;
    for (const [path, body] of writes) expect((await shopApi({ ...co, csrf: 'x' }).post(path, body)).status, path).toBe(403);
    const sales = await throwawayAdmin('SALES');
    expect((await shopApi(sales).post(`/returns/${randomUUID()}/refund-paid`, { method: 'CASH' })).status).toBe(404);
  });
});
