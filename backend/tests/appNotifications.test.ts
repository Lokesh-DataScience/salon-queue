// backend/tests/appNotifications.test.ts — Customer app, Slice 5: earlier, Hindi notifications for app customers.
// Needs step14 and step15 applied to the tests project.
import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import * as webpush from 'web-push';
import { app, makeSalon, cleanupSalons, barberCookieFor, joinViaApi } from './helpers';
import { supabase } from '../src/config/supabase';
import { todayISODate } from '../src/utils/date';
import { evaluateNotifications, desiredStage } from '../src/services/queueNotifications.service';
import {
  buildPushMessage,
  WebPushProvider,
  setNotificationProvider,
  resetNotificationProvider,
} from '../src/services/notification.service';

vi.mock('web-push', () => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));

afterAll(async () => {
  resetNotificationProvider();
  await cleanupSalons();
});

type Sent = { event: string; token: number; ahead?: number };
const sent: Sent[] = [];
beforeEach(() => {
  sent.length = 0;
  setNotificationProvider({
    send: async (event, target, data) => void sent.push({ event, token: target.tokenNumber, ahead: data?.peopleAhead }),
  });
});

async function queueWith(salonId: string, rows: { token: number; status?: string; source?: 'qr' | 'app' }[]) {
  const { data: q, error } = await supabase
    .from('queues')
    .insert({ salon_id: salonId, date: todayISODate(), current_token: 1, next_token: 20, status: 'ACTIVE' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const ids: Record<number, string> = {};
  for (const r of rows) {
    const { data, error: e2 } = await supabase
      .from('queue_entries')
      .insert({
        queue_id: q!.id,
        token_number: r.token,
        status: r.status ?? 'WAITING',
        access_token: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
        joined_at: new Date().toISOString(),
        join_source: r.source ?? 'qr',
        ...(r.status === 'SERVING' ? { started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 600_000).toISOString() } : {}),
      })
      .select('id')
      .single();
    if (e2) throw new Error(e2.message);
    ids[r.token] = data!.id as string;
  }
  return ids;
}

describe('Earlier "getting close" for app customers (Slice 5)', () => {
  it('stage rules: app customers hear "getting close" at 4 ahead, wall-QR customers at 2', () => {
    expect(desiredStage('WAITING', 4, 'app')).toBe(1);
    expect(desiredStage('WAITING', 5, 'app')).toBe(0);
    expect(desiredStage('WAITING', 4, 'qr')).toBe(0);
    expect(desiredStage('WAITING', 2, 'qr')).toBe(1);
    expect(desiredStage('WAITING', 1, 'app')).toBe(2); // "you're next" unchanged
    expect(desiredStage('SERVING', 0, 'app')).toBe(3); // "your turn" unchanged
  });

  it('in a real queue: the app customer 4 ahead is told, the QR customer 4 ahead is not', async () => {
    const salonId = await makeSalon();
    // #1 serving; #2 #3 #4 waiting (QR); #5 waiting (app, 4 ahead); #6 waiting (QR, 5 ahead)
    await queueWith(salonId, [
      { token: 1, status: 'SERVING' }, { token: 2 }, { token: 3 }, { token: 4 },
      { token: 5, source: 'app' }, { token: 6 },
    ]);
    await evaluateNotifications(salonId);

    const byToken = (t: number) => sent.filter((s) => s.token === t).map((s) => s.event);
    expect(sent).toContainEqual({ event: 'QUEUE_APPROACHING', token: 5, ahead: 4 });
    expect(byToken(4)).toEqual([]); // QR, 3 ahead: nothing yet (QR threshold is 2)
    expect(byToken(6)).toEqual([]);
  }, 60_000);

  it('each stage still fires once: the app customer is not told "getting close" twice', async () => {
    const salonId = await makeSalon();
    const ids = await queueWith(salonId, [
      { token: 1, status: 'SERVING' }, { token: 2 }, { token: 3 }, { token: 4, source: 'app' },
    ]);
    await evaluateNotifications(salonId);
    await evaluateNotifications(salonId);
    expect(sent.filter((s) => s.token === 4)).toEqual([{ event: 'QUEUE_APPROACHING', token: 4, ahead: 3 }]);

    // #2 finishes and leaves the line: #4 is now 2 ahead, still stage 1, so nothing new.
    await supabase.from('queue_entries').update({ status: 'COMPLETED' }).eq('id', ids[2]);
    sent.length = 0;
    await evaluateNotifications(salonId);
    expect(sent.filter((s) => s.token === 4)).toEqual([]);
  }, 60_000);

  it('after "Not here", the customer is told again as the line moves', async () => {
    const salonId = await makeSalon();
    const cookie = await barberCookieFor(salonId);
    const a = (await joinViaApi(salonId, { source: 'app' })).body.ticket; // starts at once
    for (let i = 0; i < 3; i++) await joinViaApi(salonId);
    await request(app).post(`/api/barber/queue/${a.ticketId}/not-here`).set('Cookie', cookie);

    // Now: #2 serving, #3 waiting, #1 waiting (2 ahead), #4 waiting. The reset stage fires again.
    const forA = sent.filter((s) => s.token === a.tokenNumber).map((s) => s.event);
    expect(forA).toContain('MOVED_BACK');
    expect(forA).toContain('QUEUE_APPROACHING');
    const { data } = await supabase.from('queue_entries').select('notified_stage').eq('id', a.ticketId).single();
    expect(data!.notified_stage).toBe(1);
  }, 90_000);
});

describe('Hindi text for app customers (Slice 5)', () => {
  const target = { entryId: 'e1', salonId: 's1', tokenNumber: 7 };

  it('app customers get Hindi; wall-QR customers keep the English text', () => {
    const appClose = buildPushMessage('QUEUE_APPROACHING', target, { peopleAhead: 4 }, 'tok', 'app');
    expect(appClose.title).toBe('आपकी बारी करीब है — अभी निकलें');
    expect(appClose.body).toContain('#7');
    expect(buildPushMessage('QUEUE_APPROACHING', target, { peopleAhead: 1 }, 'tok', 'app').title).toBe('आप अगले हैं');
    expect(buildPushMessage('TURN_NOW', target, undefined, 'tok', 'app').title).toBe('आपकी बारी आ गई');
    expect(buildPushMessage('QUEUE_CANCELLED', target, undefined, 'tok', 'app').title).toBe('आपका टोकन रद्द हुआ');

    expect(buildPushMessage('QUEUE_APPROACHING', target, { peopleAhead: 2 }, 'tok').title).toBe("You're getting close");
    expect(buildPushMessage('TURN_NOW', target, undefined, 'tok', 'qr').title).toBe("It's your turn");
  });

  it('the link still opens the ticket, and no message carries anything personal', () => {
    for (const source of ['app', 'qr']) {
      const m = buildPushMessage('TURN_NOW', target, undefined, 'tok123', source);
      expect(m.url).toBe('/tickets/e1?accessToken=tok123');
    }
  });

  it('the Web Push provider picks the language from the ticket itself', async () => {
    const sendMock = vi.mocked(webpush.sendNotification);
    sendMock.mockReset().mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const salonId = await makeSalon();
    const ids = await queueWith(salonId, [{ token: 1, status: 'SERVING' }, { token: 2, source: 'app' }]);
    const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } };
    await supabase.from('queue_entries').update({ push_subscription: SUB }).in('id', [ids[1], ids[2]]);

    const provider = new WebPushProvider({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:test@example.com' });
    await provider.send('TURN_NOW', { entryId: ids[2], salonId, tokenNumber: 2 });
    await provider.send('TURN_NOW', { entryId: ids[1], salonId, tokenNumber: 1 });

    expect(JSON.parse(sendMock.mock.calls[0][1] as string).title).toBe('आपकी बारी आ गई');
    expect(JSON.parse(sendMock.mock.calls[1][1] as string).title).toBe("It's your turn");
  }, 60_000);
});
