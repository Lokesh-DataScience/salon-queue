// backend/tests/staffPush.unit.test.ts
// Barber "New token" alerts, Slice 1: message text, input rules, and "never throws".
import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import {
  buildNewTokenMessage,
  notifyStaffNewToken,
  setStaffPushSender,
  resetStaffPushSender,
} from '../src/services/staffPush.service';
import { staffPushBodySchema, staffPushDeleteSchema } from '../src/validators/staffPush.validators';

const goodSub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', auth: 'tBHItJI5svbpez7KI4CCXg' },
};

describe('buildNewTokenMessage', () => {
  it('QR join: token, name, and opens the dashboard', () => {
    const m = buildNewTokenMessage({ entryId: 'e1', tokenNumber: 14, name: 'Rahul', source: 'qr' });
    expect(m.title).toContain('#14');
    expect(m.body).toContain('Rahul');
    expect(m.body).toContain('QR');
    expect(m.url).toBe('/barber/dashboard');
    expect(m.tag).toBe('new-token-e1'); // one per token, so alerts stack
  });

  it('app join says the customer may still be at home', () => {
    const m = buildNewTokenMessage({ entryId: 'e2', tokenNumber: 3, name: 'Asha', source: 'app' });
    expect(m.body).toContain('app');
    expect(m.body).toContain('home');
  });

  it('no name: generic wording, never "null"', () => {
    const m = buildNewTokenMessage({ entryId: 'e3', tokenNumber: 5, name: null, source: 'qr' });
    expect(m.body).toMatch(/^A customer /);
    expect(m.body).not.toContain('null');
  });

  it('never contains a phone number', () => {
    const m = buildNewTokenMessage({ entryId: 'e4', tokenNumber: 9, name: 'Ravi', source: 'qr' });
    expect(`${m.title} ${m.body}`).not.toMatch(/\d{10}/);
  });
});

describe('staff push validators', () => {
  it('accepts a real push-service subscription', () => {
    expect(staffPushBodySchema.safeParse({ subscription: goodSub }).success).toBe(true);
  });

  it('rejects an endpoint that is not a push service (SSRF)', () => {
    const bad = { ...goodSub, endpoint: 'https://evil.example.com/hook' };
    expect(staffPushBodySchema.safeParse({ subscription: bad }).success).toBe(false);
  });

  it('rejects a missing subscription', () => {
    expect(staffPushBodySchema.safeParse({}).success).toBe(false);
  });

  it('delete needs an endpoint', () => {
    expect(staffPushDeleteSchema.safeParse({}).success).toBe(false);
    expect(staffPushDeleteSchema.safeParse({ endpoint: goodSub.endpoint }).success).toBe(true);
  });
});

describe('notifyStaffNewToken', () => {
  afterEach(() => resetStaffPushSender());

  it('unknown entry: sends nothing and does not throw', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    setStaffPushSender(spy);
    await expect(notifyStaffNewToken(randomUUID(), randomUUID())).resolves.toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
