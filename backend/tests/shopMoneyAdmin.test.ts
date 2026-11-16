// backend/tests/shopMoneyAdmin.test.ts — Commerce Phase 1, C5b: settlement, expenses, report, recovery, revoke.
// Needs step21–step24b (+ step22b) on the TESTS project and TEST_FOUNDER_* in .env.test.
// Run on its own:  npx vitest run tests/shopMoneyAdmin.test.ts
// Settlements and expenses are permanent history (by design): they stay on the tests project, linked to
// delivered test orders of soft-deleted test products.
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

type Agent = ReturnType<typeof request.agent>;
async function device(): Promise<{ agent: Agent; csrf: string }> {
  const agent = request.agent(app);
  const s = await agent.post('/api/shop/session').set('Origin', ORIGIN).send({});
  return { agent, csrf: s.body.csrfToken };
}
let phoneA: { agent: Agent; csrf: string };

async function product() {
  const r = await shopApi(founder).post('/products', productBody({ initialStock: 20 }));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  products.push(r.body.product.id);
  await shopApi(founder).post(`/products/${r.body.product.id}/availability`, { available: true });
  return r.body.product.id as string;
}

async function placeOrder(d: { agent: Agent; csrf: string }, productId: string, phone: string, qty = 2) {
  const r = await d.agent
    .post('/api/shop/orders')
    .set('Origin', ORIGIN)
    .set('X-Shop-CSRF', d.csrf)
    .set('Idempotency-Key', randomUUID())
    .send({
      items: [{ productId, qty }],
      expectedTotalPaise: qty * 22000,
      consent: true,
      customer: { name: 'Money Test', phone, addressLine1: '7 Test Lane', addressLine2: '', landmark: '', pincode: '' },
    });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.order.id as string;
}

const move = (id: string, body: Record<string, unknown>) => shopApi(founder).post(`/orders/${id}/transition`, body);

async function deliver(id: string, costPaise: number) {
  await move(id, { expectedFrom: 'PLACED', to: 'SUPPLIER_PENDING' });
  const items = (await shopApi(founder).get(`/orders/${id}`)).body.items as { id: string }[];
  await move(id, { expectedFrom: 'SUPPLIER_PENDING', to: 'SUPPLIER_CONFIRMED', lines: items.map((i) => ({ itemId: i.id, confirmedUnitCostPaise: costPaise })) });
  await move(id, { expectedFrom: 'SUPPLIER_CONFIRMED', to: 'COLLECTED' });
  await move(id, { expectedFrom: 'COLLECTED', to: 'OUT_FOR_DELIVERY' });
  const total = (await shopApi(founder).get(`/orders/${id}`)).body.order.totalPaise as number;
  const r = await shopApi(founder).post(`/orders/${id}/cod-collection`, { amountPaise: total });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  founder = await founderSession();
  const { data } = await supabase.from('feature_flags').select('enabled, value').eq('key', 'shop_enabled').single();
  originalFlag = { enabled: data!.enabled, value: data!.value };
  await supabase.from('feature_flags').update({ enabled: true }).eq('key', 'shop_enabled');
  await listFlags(true);
  phoneA = await device();
}, 60_000);

afterAll(async () => {
  await softDeleteProducts(founder, products);
  await supabase.from('feature_flags').update(originalFlag).eq('key', 'shop_enabled');
  await listFlags(true);
}, 60_000);

describe('expenses', () => {
  it('add, show in order profit, void with a reason; never edited or deleted', async () => {
    const p = await product();
    const id = await placeOrder(phoneA, p, randomMobile());
    await deliver(id, 17500);
    const add = await shopApi(founder).post(`/orders/${id}/expenses`, { kind: 'TRAVEL', amountPaise: 3000, note: 'Petrol' });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body.finance).toMatchObject({ expensesPaise: 3000, netProfitPaise: 44000 - 35000 - 3000 });
    expect((await shopApi(founder).post(`/orders/${id}/expenses`, { kind: 'TRAVEL', amountPaise: 0 })).status).toBe(400);

    const expenseId = add.body.expenses[0].id as string;
    expect((await shopApi(founder).post(`/expenses/${expenseId}/void`, { reason: '' })).status).toBe(400);
    const voided = await shopApi(founder).post(`/expenses/${expenseId}/void`, { reason: 'Entered twice' });
    expect(voided.status).toBe(200);
    expect(voided.body.finance.expensesPaise).toBe(0);
    expect(voided.body.expenses[0]).toMatchObject({ voidReason: 'Entered twice' });
    expect((await shopApi(founder).post(`/expenses/${expenseId}/void`, { reason: 'again' })).status).toBe(409);

    // the customer never sees expenses
    const mine = await phoneA.agent.get(`/api/shop/orders/${id}`);
    expect(JSON.stringify(mine.body)).not.toMatch(/expense|Petrol|17500/i);
  });
});

describe('supplier settlement', () => {
  it('pending lists delivered unsettled orders; paying them once links them; never twice', async () => {
    const p = await product();
    const a = await placeOrder(phoneA, p, randomMobile());
    const b = await placeOrder(phoneA, p, randomMobile(), 1);
    const notDelivered = await placeOrder(phoneA, p, randomMobile(), 1);
    await deliver(a, 17500);
    await deliver(b, 18000);

    const pending = await shopApi(founder).get('/settlements/pending');
    expect(pending.status).toBe(200);
    const ours = pending.body.orders.filter((o: { id: string }) => [a, b].includes(o.id));
    expect(ours.map((o: { payablePaise: number }) => o.payablePaise).sort()).toEqual([18000, 35000]);
    expect(pending.body.orders.some((o: { id: string }) => o.id === notDelivered)).toBe(false);

    expect((await shopApi(founder).post('/settlements', { orderIds: [notDelivered], amountPaise: 100, method: 'CASH' })).status).toBe(409);
    const short = await shopApi(founder).post('/settlements', { orderIds: [a, b], amountPaise: 50000, method: 'UPI' });
    expect(short.status).toBe(400);
    expect(short.body.message).toMatch(/write a short note/);

    const paid = await shopApi(founder).post('/settlements', { orderIds: [a, b], amountPaise: 53000, method: 'UPI', reference: 'UTR123' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ payablePaise: 53000, orderCount: 2 });
    expect((await shopApi(founder).post('/settlements', { orderIds: [a], amountPaise: 35000, method: 'CASH' })).status).toBe(409);
    expect((await shopApi(founder).get(`/orders/${a}`)).body.order.supplierSettled).toBe(true);

    const list = await shopApi(founder).get('/settlements');
    const row = list.body.settlements.find((s: { id: string }) => s.id === paid.body.settlementId);
    expect(row).toMatchObject({ amountPaise: 53000, method: 'UPI', reference: 'UTR123', orderCount: 2 });

    await move(notDelivered, { expectedFrom: 'PLACED', to: 'CANCELLED', note: 'test cleanup' });
  });

  it('two settlements of the same order at the same moment: exactly one wins', async () => {
    const p = await product();
    const id = await placeOrder(phoneA, p, randomMobile(), 1);
    await deliver(id, 18000);
    const both = await Promise.all([1, 2].map(() => shopApi(founder).post('/settlements', { orderIds: [id], amountPaise: 18000, method: 'CASH' })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('report', () => {
  it('today: delivered orders, sales, cost, expenses, profit and what is owed', async () => {
    const r = await shopApi(founder).get(`/report?from=${todayIst()}&to=${todayIst()}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.deliveredOrders).toBeGreaterThanOrEqual(4);
    expect(r.body.grossMarginPaise).toBe(r.body.salesPaise - r.body.supplierCostPaise);
    expect(r.body.netProfitPaise).toBe(r.body.collectedPaise - r.body.supplierCostPaise - r.body.expensesPaise - r.body.refundsPaidPaise);
    expect(r.body.orders.length).toBe(r.body.deliveredOrders);
    expect(JSON.stringify(r.body)).not.toMatch(/Money Test|Test Lane|\+91/);
    expect((await shopApi(founder).get('/report?from=2026-12-01&to=2026-11-01')).status).toBe(400);
  });
});

describe('recovery and revoke (founder callback)', () => {
  it('a new phone gets the orders back with phone + code; wrong tries fail the same way; revoke stops it', async () => {
    const p = await product();
    const phone = randomMobile();
    const id = await placeOrder(phoneA, p, phone, 1);
    const customerId = (await shopApi(founder).get(`/orders/${id}`)).body.order.customerId as string;

    const newPhone = await device();
    const tryCode = (d: { agent: Agent; csrf: string }, ph: string, code: string) =>
      d.agent.post('/api/shop/recovery/verify').set('Origin', ORIGIN).set('X-Shop-CSRF', d.csrf).send({ phone: ph, code });

    // no code yet / unknown number: same answer
    const none = await tryCode(newPhone, phone, '123456');
    const unknown = await tryCode(newPhone, randomMobile(), '123456');
    expect([none.status, unknown.status]).toEqual([400, 400]);
    expect(none.body.message).toBe(unknown.body.message);

    const made = await shopApi(founder).post(`/customers/${customerId}/recovery-code`, {});
    expect(made.status).toBe(200);
    expect(made.headers['cache-control']).toBe('no-store');
    expect(made.body.code).toMatch(/^\d{3} \d{3}$/);
    const digits = made.body.code.replace(' ', '');
    const wrong = digits === '000000' ? '111111' : '000000';
    expect((await tryCode(newPhone, phone, wrong)).status).toBe(400);

    // the code is bound to its number: the right code with another number fails
    expect((await tryCode(newPhone, randomMobile(), digits)).status).toBe(400);

    const ok = await tryCode(newPhone, phone, made.body.code);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.recovered).toBe(true);
    expect(String(ok.headers['set-cookie'])).toMatch(/svq_shop_access=/);
    const mine = await newPhone.agent.get('/api/shop/orders');
    expect(mine.body.orders.map((o: { id: string }) => o.id)).toContain(id);
    // verified now: saved details prefill
    const pre = await newPhone.agent.get('/api/shop/prefill');
    expect(pre.body.verified).toBe(true);
    // used once only
    expect((await tryCode(await device(), phone, made.body.code)).status).toBe(400);

    // the founder sees the phones and when they were used, never secrets; codes are never shown again
    const cust = await shopApi(founder).get(`/customers/${customerId}`);
    expect(cust.status).toBe(200);
    expect(cust.body.devices.length).toBe(2);
    expect(JSON.stringify(cust.body)).not.toMatch(/key_hash|code_hash/);
    expect(JSON.stringify(cust.body)).not.toContain(digits);
    const recovered = cust.body.devices.find((d: { verifiedBy: string | null }) => d.verifiedBy === 'FOUNDER_CALLBACK');
    const activeKey = recovered.keys.find((k: { revokedAt: string | null }) => !k.revokedAt);

    const revoked = await shopApi(founder).post(`/customers/${customerId}/keys/${activeKey.id}/revoke`, {});
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    const after = await newPhone.agent.get('/api/shop/orders');
    expect(JSON.stringify(after.body)).not.toContain(id);
    expect((await shopApi(founder).post(`/customers/${customerId}/keys/${activeKey.id}/revoke`, {})).status).toBe(409);

    const { data: audit } = await supabase.from('admin_audit_log').select('details').eq('target_id', customerId);
    expect(JSON.stringify(audit)).not.toContain(phone.slice(-10));
    expect(JSON.stringify(audit)).not.toContain(digits);

    await move(id, { expectedFrom: 'PLACED', to: 'CANCELLED', note: 'test cleanup' });
  });
});

describe('permissions', () => {
  it('cofounder reads money and customers but every C5b write is refused', async () => {
    const co = await throwawayAdmin('COFOUNDER');
    expect((await shopApi(co).get('/settlements/pending')).status).toBe(200);
    expect((await shopApi(co).get(`/report?from=${todayIst()}&to=${todayIst()}`)).status).toBe(200);
    const writes = [
      ['/settlements', { orderIds: [randomUUID()], amountPaise: 1, method: 'CASH' }],
      [`/orders/${randomUUID()}/expenses`, { kind: 'OTHER', amountPaise: 1 }],
      [`/expenses/${randomUUID()}/void`, { reason: 'xxx' }],
      [`/customers/${randomUUID()}/recovery-code`, {}],
      [`/customers/${randomUUID()}/keys/${randomUUID()}/revoke`, {}],
    ] as const;
    for (const [path, body] of writes) expect((await shopApi({ ...co, csrf: 'x' }).post(path, body)).status, path).toBe(403);
    const sales = await throwawayAdmin('SALES');
    expect((await shopApi(sales).get('/report?from=2026-11-01&to=2026-11-02')).status).toBe(404);
  });
});
