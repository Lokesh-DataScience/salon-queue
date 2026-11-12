// backend/tests/pushStats.test.ts — Admin Slice 9b: push delivery counts.
// web-push is replaced with a fake here, so nothing is really sent. Run this file on its own.
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'crypto';

vi.mock('web-push', () => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));
import * as webpush from 'web-push';

import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';
import { WebPushProvider } from '../src/services/notification.service';
import { todayISODate } from '../src/utils/date';

afterAll(cleanupSalons);
beforeEach(() => vi.mocked(webpush.sendNotification).mockReset());

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
async function counts() {
  const { data } = await supabase.from('push_daily').select('sent, expired, failed, last_failure_code').eq('day', today()).maybeSingle();
  return { sent: data?.sent ?? 0, expired: data?.expired ?? 0, failed: data?.failed ?? 0, code: data?.last_failure_code ?? null };
}
// recordPush is fire-and-forget: wait for the count to move.
async function until(check: (c: Awaited<ReturnType<typeof counts>>) => boolean) {
  for (let i = 0; i < 20; i++) {
    const c = await counts();
    if (check(c)) return c;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('count did not change');
}

async function entryWithPush(salonId: string) {
  const { data: q } = await supabase
    .from('queues')
    .insert({ salon_id: salonId, date: todayISODate(), current_token: 0, next_token: 2, status: 'ACTIVE' })
    .select('id').single();
  const { data, error } = await supabase.from('queue_entries').insert({
    queue_id: q!.id, token_number: 1, status: 'WAITING', joined_at: new Date().toISOString(),
    access_token: randomBytes(32).toString('hex'),
    push_subscription: { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'x', auth: 'y' } },
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

const provider = () => new WebPushProvider({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:test@example.test' });

describe('Push delivery counts (Slice 9b)', () => {
  it('counts sent, expired (and clears the subscription) and failed with only the HTTP status', async () => {
    const salonId = await makeSalon();
    const target = (entryId: string) => ({ entryId, salonId, tokenNumber: 1 });

    const before = await counts();
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({} as never);
    await provider().send('TURN_NOW', target(await entryWithPush(salonId)));
    await until((c) => c.sent === before.sent + 1);

    const gone = await entryWithPush(await makeSalon());
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(Object.assign(new Error('gone https://push.example.test/abc'), { statusCode: 410 }));
    await provider().send('TURN_NOW', target(gone));
    await until((c) => c.expired === before.expired + 1);
    const { data: cleared } = await supabase.from('queue_entries').select('push_subscription').eq('id', gone).single();
    expect(cleared?.push_subscription).toBeNull();

    const broken = await entryWithPush(await makeSalon());
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(Object.assign(new Error('server https://push.example.test/abc'), { statusCode: 500 }));
    await expect(provider().send('TURN_NOW', target(broken))).rejects.toThrow();
    const after = await until((c) => c.failed === before.failed + 1);
    expect(after.code).toBe('HTTP_500');
  }, 120_000);

  it('shows the numbers on the Tech queues view', async () => {
    const cookie = await barberCookieFor(await makeSalon({ is_internal: true }));
    const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
    await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role: 'TECH' });

    const res = await request(app).get('/api/admin/tech/queues').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.pushDelivery.today).toEqual(expect.objectContaining({ day: today() }));
    expect(res.body.pushDelivery.today.sent).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(res.body.pushDelivery)).not.toContain('push.example.test');
  }, 120_000);
});
