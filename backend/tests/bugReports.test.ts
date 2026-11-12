// backend/tests/bugReports.test.ts — Admin Slice 10: bug reports.
// Run this file on its own.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';

const reportIds: string[] = [];
afterAll(async () => {
  if (reportIds.length) await supabase.from('bug_reports').delete().in('id', reportIds);
  await cleanupSalons();
});

async function admin(role: 'TECH' | 'SALES') {
  const cookie = await barberCookieFor(await makeSalon({ is_internal: true }));
  const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role });
  if (error) throw new Error(error.message);
  return cookie;
}

const report = (cookie: string, body: object) =>
  request(app).post('/api/barber/bug-reports').set('Cookie', cookie).send(body);

describe('Bug reports (Slice 10)', () => {
  it('a barber sends a report, sees only their own, and the page link loses its query string', async () => {
    const barber = await barberCookieFor(await makeSalon());
    const other = await barberCookieFor(await makeSalon());

    const res = await report(barber, {
      kind: 'bug',
      message: 'The +1 button did nothing this morning.',
      page: '/tickets/abc?accessToken=SECRET123',
      device: 'Android 13, Chrome 130',
    });
    expect(res.status).toBe(201);
    reportIds.push(res.body.report.id);
    expect(res.body.report.status).toBe('new');

    const { data: row } = await supabase.from('bug_reports').select('page').eq('id', res.body.report.id).single();
    expect(row?.page).toBe('/tickets/abc');

    const mine = await request(app).get('/api/barber/bug-reports').set('Cookie', barber);
    expect(mine.body.reports.map((r: { id: string }) => r.id)).toContain(res.body.report.id);
    const theirs = await request(app).get('/api/barber/bug-reports').set('Cookie', other);
    expect(theirs.body.reports.map((r: { id: string }) => r.id)).not.toContain(res.body.report.id);
  }, 120_000);

  it('rejects empty, too long and unknown fields, and needs a signed-in barber', async () => {
    const barber = await barberCookieFor(await makeSalon());
    expect((await report(barber, { message: 'hi' })).status).toBe(400);
    expect((await report(barber, { message: 'x'.repeat(2001) })).status).toBe(400);
    expect((await report(barber, { message: 'Something broke', salonId: randomUUID() })).status).toBe(400);
    expect((await request(app).post('/api/barber/bug-reports').send({ message: 'Something broke' })).status).toBe(401);
  }, 120_000);

  it('allows at most 5 reports an hour per account', async () => {
    const barber = await barberCookieFor(await makeSalon());
    for (let i = 0; i < 5; i++) {
      const r = await report(barber, { kind: 'idea', message: `Idea number ${i + 1}` });
      expect(r.status).toBe(201);
      reportIds.push(r.body.report.id);
    }
    expect((await report(barber, { message: 'One more idea' })).status).toBe(429);
  }, 120_000);

  it('Tech lists open reports with salon and reporter, sets status and a note the barber can see', async () => {
    const barber = await barberCookieFor(await makeSalon({ name: `Bug Salon ${randomUUID().slice(0, 6)}` }));
    const sent = await report(barber, { kind: 'question', message: 'How do I print the QR again?' });
    reportIds.push(sent.body.report.id);
    const id = sent.body.report.id as string;

    const sales = await admin('SALES');
    expect((await request(app).get('/api/admin/tech/bugs').set('Cookie', sales)).status).toBe(404);

    const tech = await admin('TECH');
    const open = await request(app).get('/api/admin/tech/bugs').set('Cookie', tech);
    expect(open.status).toBe(200);
    const found = open.body.reports.find((r: { id: string }) => r.id === id);
    expect(found).toMatchObject({ kind: 'question', status: 'new' });
    expect(found.salonName).toMatch(/^Bug Salon/);
    expect(found.reporter.contact).toBeTruthy();

    const upd = await request(app)
      .patch(`/api/admin/tech/bugs/${id}`)
      .set('Cookie', tech)
      .send({ status: 'fixed', techNote: 'Settings → Salon QR code → Print.' });
    expect(upd.status).toBe(200);

    const mine = await request(app).get('/api/barber/bug-reports').set('Cookie', barber);
    expect(mine.body.reports.find((r: { id: string }) => r.id === id)).toMatchObject({
      status: 'fixed',
      techNote: 'Settings → Salon QR code → Print.',
    });

    const stillOpen = await request(app).get('/api/admin/tech/bugs?status=open').set('Cookie', tech);
    expect(stillOpen.body.reports.some((r: { id: string }) => r.id === id)).toBe(false);
    const all = await request(app).get('/api/admin/tech/bugs?status=all').set('Cookie', tech);
    expect(all.body.reports.some((r: { id: string }) => r.id === id)).toBe(true);

    const { count } = await supabase
      .from('admin_audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'tech.bug_status')
      .eq('target_id', id);
    expect(count).toBe(1);

    expect((await request(app).patch(`/api/admin/tech/bugs/${randomUUID()}`).set('Cookie', tech).send({ status: 'fixed' })).status).toBe(404);
    expect((await request(app).patch(`/api/admin/tech/bugs/${id}`).set('Cookie', tech).send({ status: 'done' })).status).toBe(400);
  }, 180_000);
});
