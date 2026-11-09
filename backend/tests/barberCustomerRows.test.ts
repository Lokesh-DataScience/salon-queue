// backend/tests/barberCustomerRows.test.ts
// Slice 3: the barber's queue rows show the customer's name and phone, and nobody else gets them.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor, customerDetails } from './helpers';
import { getSanitizedQueueState } from '../src/services/queue.service';

afterAll(cleanupSalons);

const join = (salonId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/queues/${salonId}/join`).send(body);

async function joinOk(salonId: string, body: Record<string, unknown>) {
  const res = await join(salonId, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.ticket as { ticketId: string; accessToken: string; tokenNumber: number };
}

const dashboard = (cookie: string) => request(app).get('/api/barber/queue').set('Cookie', cookie);

describe('Barber queue rows carry the customer details', () => {
  it('shows name and phone on the serving and waiting rows, and nulls on a walk-in', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    const a = customerDetails({ name: 'Ravi Kumar' });
    const b = customerDetails({ name: 'Meena  Iyer' }); // extra space is tidied

    await joinOk(salonId, a); // front customer starts at once
    await joinOk(salonId, b);
    const walkIn = await request(app).post('/api/barber/queue/walk-in').set('Cookie', cookie);
    expect(walkIn.status, JSON.stringify(walkIn.body)).toBeLessThan(300);

    const res = await dashboard(cookie);
    expect(res.status).toBe(200);
    const rows = [res.body.called, res.body.serving, ...res.body.waiting].filter(Boolean);
    expect(rows).toHaveLength(3);

    const byName = (n: string) => rows.find((r: { customer_name: string | null }) => r.customer_name === n);
    expect(byName('Ravi Kumar')?.customer_phone).toBe(a.phone);
    expect(byName('Meena Iyer')?.customer_phone).toBe(b.phone);

    const anon = rows.filter((r: { customer_name: string | null }) => r.customer_name === null);
    expect(anon).toHaveLength(1);
    expect(anon[0].customer_phone).toBeNull();

    // The joined relation is flattened away, never sent as a nested object.
    for (const r of rows) expect(r).not.toHaveProperty('salon_customers');
  }, 60_000);

  it('a staff barber sees the details of their own line, and another salon sees nothing of it', async () => {
    const salonA = await makeSalon();
    const salonB = await makeSalon();
    const staffA = await barberCookieFor(salonA, 'BARBER');
    const cookieB = await barberCookieFor(salonB);
    const d = customerDetails({ name: 'Only At A' });
    await joinOk(salonA, d);

    const own = await dashboard(staffA);
    expect(JSON.stringify(own.body)).toContain('Only At A');

    const other = await dashboard(cookieB);
    expect(JSON.stringify(other.body)).not.toContain('Only At A');
    expect(JSON.stringify(other.body)).not.toContain(d.phone);
  }, 60_000);

  it('the customer side never carries them: ticket route, ticket status and the broadcast state', async () => {
    const salonId = await makeSalon();
    const d = customerDetails({ name: 'Private Person' });
    const t = await joinOk(salonId, d);

    const ticket = await request(app).get(`/api/queue-tickets/${t.ticketId}`).set('X-Ticket-Token', t.accessToken);
    expect(ticket.status).toBe(200);
    expect(JSON.stringify(ticket.body)).not.toContain('Private Person');
    expect(JSON.stringify(ticket.body)).not.toContain(d.phone);

    const state = await getSanitizedQueueState(salonId);
    expect(JSON.stringify(state)).not.toContain('Private Person');
    expect(JSON.stringify(state)).not.toContain(d.phone);
  }, 60_000);

  it('an unauthenticated request gets nothing', async () => {
    expect((await request(app).get('/api/barber/queue')).status).toBe(401);
  });

  it("a customer removed from the list leaves the ticket in the queue with no name", async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    const t = await joinOk(salonId, customerDetails({ name: 'To Remove' }));

    const list = await request(app).get('/api/barber/customers').set('Cookie', cookie);
    const row = list.body.customers.find((c: { name: string }) => c.name === 'To Remove');
    expect(row).toBeTruthy();
    expect((await request(app).delete(`/api/barber/customers/${row.id}`).set('Cookie', cookie)).status).toBeLessThan(300);

    const res = await dashboard(cookie);
    const rows = [res.body.called, res.body.serving, ...res.body.waiting].filter(Boolean);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_number).toBe(t.tokenNumber);
    expect(rows[0].customer_name).toBeNull();
    expect(rows[0].customer_phone).toBeNull();
  }, 60_000);
});