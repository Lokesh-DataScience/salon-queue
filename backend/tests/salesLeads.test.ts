// backend/tests/salesLeads.test.ts — Admin Slice 6: leads tracker.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';

const created: string[] = [];
afterAll(async () => {
  if (created.length) await supabase.from('sales_leads').delete().in('id', created);
  await cleanupSalons();
});

async function admin(role: 'SALES' | 'TECH') {
  const cookie = await barberCookieFor(await makeSalon({ is_internal: true }));
  const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role });
  if (error) throw new Error(error.message);
  return cookie;
}

// A random valid-looking Indian mobile number, so reruns don't collide.
const mobile = () => `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

const api = (cookie: string) => ({
  list: () => request(app).get('/api/admin/sales/leads').set('Cookie', cookie),
  create: (b: object) => request(app).post('/api/admin/sales/leads').set('Cookie', cookie).send(b),
  update: (id: string, b: object) => request(app).patch(`/api/admin/sales/leads/${id}`).set('Cookie', cookie).send(b),
  remove: (id: string) => request(app).delete(`/api/admin/sales/leads/${id}`).set('Cookie', cookie),
});

describe('Leads (Slice 6)', () => {
  it('is for SALES and FOUNDER only', async () => {
    const tech = await admin('TECH');
    expect((await api(tech).list()).status).toBe(404);
    expect((await api(tech).create({ name: 'X' })).status).toBe(404);
  }, 120_000);

  it('creates, lists, updates and deletes a lead, with audit records', async () => {
    const sales = await admin('SALES');
    const phone = mobile();
    const res = await api(sales).create({
      name: 'Raju Hair Point', ownerName: 'Raju', phone: `+91 ${phone}`, area: 'Korba',
      followUpOn: '2026-11-20', notes: 'Met at the market.',
    });
    expect(res.status).toBe(201);
    const lead = res.body.lead;
    created.push(lead.id);
    expect(lead).toMatchObject({ name: 'Raju Hair Point', status: 'new', followUpOn: '2026-11-20' });

    const list = await api(sales).list();
    expect(list.status).toBe(200);
    expect(list.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(list.body.leads.some((l: { id: string }) => l.id === lead.id)).toBe(true);

    const upd = await api(sales).update(lead.id, { status: 'demo', followUpOn: null });
    expect(upd.status).toBe(200);
    expect(upd.body.lead).toMatchObject({ status: 'demo', followUpOn: null, notes: 'Met at the market.' });

    expect((await api(sales).remove(lead.id)).status).toBe(200);
    expect((await api(sales).remove(lead.id)).status).toBe(404);

    const { data: log } = await supabase.from('admin_audit_log').select('action').eq('target_id', lead.id).order('id');
    expect((log ?? []).map((r) => r.action)).toEqual(['sales.lead_create', 'sales.lead_update', 'sales.lead_delete']);
  }, 120_000);

  it('links a lead to its salon once it registers, which marks it signed up', async () => {
    const sales = await admin('SALES');
    const salonId = await makeSalon();
    const { body } = await api(sales).create({ name: `Link Test ${randomUUID().slice(0, 6)}` });
    created.push(body.lead.id);

    const linked = await api(sales).update(body.lead.id, { salonId });
    expect(linked.status).toBe(200);
    expect(linked.body.lead).toMatchObject({ status: 'converted', salonId });
    expect(linked.body.lead.salonName).toBeTruthy();

    expect((await api(sales).update(body.lead.id, { salonId: randomUUID() })).status).toBe(404);
  }, 120_000);

  it('rejects bad input and duplicate phones', async () => {
    const sales = await admin('SALES');
    const phone = mobile();
    const first = await api(sales).create({ name: 'First', phone });
    created.push(first.body.lead.id);

    const dup = await api(sales).create({ name: 'Second', phone });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain('First');

    expect((await api(sales).create({ name: '' })).status).toBe(400);
    expect((await api(sales).create({ name: 'Bad phone', phone: '12' })).status).toBe(400);
    expect((await api(sales).create({ name: 'Bad status', status: 'maybe' })).status).toBe(400);
    expect((await api(sales).create({ name: 'Bad date', followUpOn: '20/11/2026' })).status).toBe(400);
    expect((await api(sales).update(first.body.lead.id, {})).status).toBe(400);
    expect((await api(sales).update(randomUUID(), { status: 'contacted' })).status).toBe(404);
  }, 120_000);
});
