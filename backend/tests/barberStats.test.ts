// backend/tests/barberStats.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomUUID, randomBytes } from 'crypto';
import { app, makeSalon, cleanupSalons } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const PASSWORD = 'testpass123';

// ── date helpers (all IST, so the tests don't depend on when they run) ──
function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
function shiftDay(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const at = (ymd: string, hhmm: string) => `${ymd}T${hhmm}:00+05:30`;
const monthStartOf = (ymd: string) => `${ymd.slice(0, 8)}01`;
const prevMonthStartOf = (ymd: string) => monthStartOf(shiftDay(monthStartOf(ymd), -1));
function daysInMonthOf(ymd: string): number {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ── fixtures ──
async function makeBarber() {
  const salonId = await makeSalon();
  const email = `stats-${randomUUID()}@example.test`;
  const { error } = await supabase.from('salon_staff').insert({
    salon_id: salonId,
    name: 'Stats Barber',
    email,
    password_hash: await bcrypt.hash(PASSWORD, 4),
    role: 'OWNER',
  });
  if (error) throw new Error(`makeBarber failed: ${error.message}`);

  const res = await request(app).post('/api/auth/barber/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  const cookie = raw.find((c) => c.startsWith('access_token='))!.split(';')[0];

  const { data: q, error: qErr } = await supabase
    .from('queues')
    .insert({ salon_id: salonId, date: istToday(), current_token: 0, next_token: 1, status: 'ACTIVE' })
    .select('id')
    .single();
  if (qErr || !q) throw new Error(`queue insert failed: ${qErr?.message}`);

  return { salonId, cookie, queueId: q.id as string };
}

let nextToken = 1;
async function addEntry(
  queueId: string,
  o: { status?: string; completedAt?: string; walkIn?: boolean; name?: string; phone?: string },
) {
  const { error } = await supabase.from('queue_entries').insert({
    queue_id: queueId,
    token_number: nextToken++,
    status: o.status ?? 'COMPLETED',
    joined_at: new Date().toISOString(),
    access_token: randomBytes(32).toString('hex'),
    completed_at: o.completedAt ?? null,
    is_walk_in: o.walkIn ?? false,
    customer_name: o.name ?? null,
    customer_phone: o.phone ?? null,
  });
  if (error) throw new Error(`addEntry failed: ${error.message}`);
}

const getStats = (cookie: string) => request(app).get('/api/barber/stats').set('Cookie', cookie);

describe('GET /api/barber/stats', () => {
  it('rejects a request with no session', async () => {
    expect((await request(app).get('/api/barber/stats')).status).toBe(401);
  });

  it('a salon with no data returns zeros and full-length day arrays', async () => {
    const { cookie } = await makeBarber();
    const res = await getStats(cookie);
    expect(res.status).toBe(200);
    const s = res.body.stats;
    const today = istToday();

    expect(s.today).toBe(today);
    expect(s.servedToday).toBe(0);
    expect(s.servedYesterday).toBe(0);
    expect(s.week.total).toBe(0);
    expect(s.month.total).toBe(0);
    expect(s.week.days).toHaveLength(7);
    expect(s.month.days).toHaveLength(daysInMonthOf(today));
    expect(s.week.days[0].date <= today).toBe(true); // week starts on or before today
    expect(s.month.days[0].date).toBe(monthStartOf(today));
  });

  it('counts only COMPLETED entries, and splits QR from walk-in', async () => {
    const { cookie, queueId } = await makeBarber();
    const today = istToday();

    await addEntry(queueId, { completedAt: at(today, '12:00') });
    await addEntry(queueId, { completedAt: at(today, '12:30') });
    await addEntry(queueId, { completedAt: at(today, '13:00'), walkIn: true });
    // Never counted, even with a completed_at set: wrong status.
    await addEntry(queueId, { status: 'CANCELLED', completedAt: at(today, '14:00') });
    await addEntry(queueId, { status: 'SKIPPED', completedAt: at(today, '14:10') });
    await addEntry(queueId, { status: 'WAITING' });

    const s = (await getStats(cookie)).body.stats;
    expect(s.servedToday).toBe(3);
    expect(s.walkInToday).toBe(1);
    expect(s.qrToday).toBe(2);
    expect(s.week.total).toBe(3);
    expect(s.week.walkIn).toBe(1);
    expect(s.week.qr).toBe(2);
    expect(s.month.total).toBe(3);
  });

  it('only counts the logged-in barber\'s own salon', async () => {
    const a = await makeBarber();
    const b = await makeBarber();
    const today = istToday();

    await addEntry(a.queueId, { completedAt: at(today, '11:00') });
    await addEntry(b.queueId, { completedAt: at(today, '11:00') });
    await addEntry(b.queueId, { completedAt: at(today, '11:30') });
    await addEntry(b.queueId, { completedAt: at(today, '12:00'), walkIn: true });

    const sa = (await getStats(a.cookie)).body.stats;
    const sb = (await getStats(b.cookie)).body.stats;
    expect(sa.servedToday).toBe(1);
    expect(sb.servedToday).toBe(3);
    expect(sb.walkInToday).toBe(1);
  });

  it('assigns days by IST, not UTC (00:15 IST is still the previous UTC day)', async () => {
    const { cookie, queueId } = await makeBarber();
    const today = istToday();
    const yesterday = shiftDay(today, -1);

    await addEntry(queueId, { completedAt: at(today, '00:15') }); // UTC date = yesterday
    await addEntry(queueId, { completedAt: at(yesterday, '23:45') }); // UTC date = yesterday too, IST = yesterday

    const s = (await getStats(cookie)).body.stats;
    expect(s.servedToday).toBe(1);
    expect(s.servedYesterday).toBe(1);
  });

  it('compares the same elapsed period of the previous week and month', async () => {
    const { cookie, queueId } = await makeBarber();
    const today = istToday();

    await addEntry(queueId, { completedAt: at(shiftDay(today, -7), '12:00') }); // same weekday last week
    await addEntry(queueId, { completedAt: at(prevMonthStartOf(today), '12:00') }); // 1st of last month
    await addEntry(queueId, { completedAt: at(shiftDay(prevMonthStartOf(today), -1), '12:00') }); // too old
    await addEntry(queueId, { completedAt: at(today, '12:00') });

    const s = (await getStats(cookie)).body.stats;
    expect(s.week.prevSamePeriod).toBe(1);
    expect(s.week.total).toBe(1); // last week's entry is not in this week
    expect(s.month.prevSamePeriod).toBe(1); // the too-old entry is not counted anywhere
    expect(s.month.total).toBeGreaterThanOrEqual(1);
  });

  it('returns counts only, with no customer data, and is unaffected by data cleanup', async () => {
    const { cookie, queueId } = await makeBarber();
    const today = istToday();
    await addEntry(queueId, { completedAt: at(today, '10:00'), name: 'Test Customer', phone: '9876543210' });

    const before = await getStats(cookie);
    expect(JSON.stringify(before.body)).not.toMatch(/9876543210|Test Customer|phone|name|token|access/i);
    expect(before.body.stats.servedToday).toBe(1);

    // What the retention job does to an entry: the personal fields are nulled, the row stays.
    await supabase
      .from('queue_entries')
      .update({ customer_name: null, customer_phone: null })
      .eq('queue_id', queueId);

    const after = await getStats(cookie);
    expect(after.body.stats.servedToday).toBe(1);
  });
});