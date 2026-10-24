// backend/tests/notifications.test.ts
import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { makeSalon, cleanupSalons } from './helpers';
import { joinQueue } from '../src/services/queue.service';
import { callNext, startEntry } from '../src/services/barber.service';
import { evaluateNotifications } from '../src/services/queueNotifications.service';
import { setNotificationProvider, resetNotificationProvider } from '../src/services/notification.service';

afterAll(cleanupSalons);

type Sent = { event: string; token: number; ahead?: number };
const sent: Sent[] = [];

beforeEach(() => {
  sent.length = 0;
  setNotificationProvider({
    send: async (event, target, data) => {
      sent.push({ event, token: target.tokenNumber, ahead: data?.peopleAhead });
    },
  });
});

// Mirrors what the join controller does.
async function join(salonId: string, name: string, phone = '9876543210') {
  const t = await joinQueue(salonId, name, phone);
  await evaluateNotifications(salonId, { silentEntryId: t.ticketId });
  return t;
}
const both = (salonId: string) => Promise.all([evaluateNotifications(salonId), evaluateNotifications(salonId)]);

describe('Notifications', () => {
  it('fires each stage once per ticket, even when evaluated concurrently', async () => {
    const salonId = await makeSalon();
    const a = await join(salonId, 'A');
    await join(salonId, 'B');
    await join(salonId, 'C');
    await join(salonId, 'D');
    expect(sent).toHaveLength(0); // joining never fires instantly

    await callNext(salonId); // A called
    await both(salonId);
    expect(sent).toEqual([{ event: 'TURN_NOW', token: 1, ahead: undefined }]);

    await startEntry(salonId, a.ticketId);
    await callNext(salonId); // A completed, B called
    await both(salonId);

    const second = sent.slice(1).map((s) => `${s.event}:${s.token}:${s.ahead ?? '-'}`).sort();
    expect(second).toEqual(['QUEUE_APPROACHING:3:1', 'QUEUE_APPROACHING:4:2', 'TURN_NOW:2:-'].sort());
    expect(sent).toHaveLength(4); // A's TURN_NOW was not repeated
  });
});

describe('Privacy: logs', () => {
  it('never contain a customer name or phone', async () => {
    resetNotificationProvider(); // real console provider
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];

    const salonId = await makeSalon();
    const NAME = 'Zeta Unique Name';
    const PHONE = '9123456780';
    await join(salonId, NAME, PHONE);
    await join(salonId, 'Other', '9123456781');
    await callNext(salonId);
    await evaluateNotifications(salonId);

    const output = spies.flatMap((s) => s.mock.calls).map((args) => args.map(String).join(' ')).join('\n');
    spies.forEach((s) => s.mockRestore());

    expect(output).toContain('[notify]'); // proves something was actually logged
    expect(output).not.toContain(NAME);
    expect(output).not.toContain(PHONE);
    expect(output).not.toContain('9123456781');
  });
});