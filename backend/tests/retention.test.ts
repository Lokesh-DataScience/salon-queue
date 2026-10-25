import { describe, it, expect, afterAll } from 'vitest';
import { makeSalon, cleanupSalons, plantLegacyPersonalData } from './helpers';
import { joinQueue } from '../src/services/queue.service';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

async function entry(id: string) {
  const { data } = await supabase
    .from('queue_entries')
    .select('token_number, status, customer_name, customer_phone')
    .eq('id', id)
    .single();
  return data!;
}

describe('Anonymous join', () => {
  it('stores no personal data at all', async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    expect(await entry(t.ticketId)).toMatchObject({ customer_name: null, customer_phone: null });
  });
});

describe('Test 5: retention cleanup (legacy rows)', () => {
  it('deletes name and phone from old finished entries only', async () => {
    const salonId = await makeSalon();
    const old = await joinQueue(salonId);
    const recent = await joinQueue(salonId);
    const active = await joinQueue(salonId);
    for (const [t, n] of [[old, 'Old'], [recent, 'Recent'], [active, 'Active']] as const)
      await plantLegacyPersonalData(t.ticketId, n, '9876543210');

    await supabase.from('queue_entries').update({ status: 'COMPLETED', completed_at: hoursAgo(48) }).eq('id', old.ticketId);
    await supabase.from('queue_entries').update({ status: 'COMPLETED', completed_at: hoursAgo(1) }).eq('id', recent.ticketId);

    const { error } = await supabase.rpc('cleanup_customer_data', { p_retention_hours: 24 });
    expect(error).toBeNull();

    expect(await entry(old.ticketId)).toMatchObject({ token_number: 1, status: 'COMPLETED', customer_name: null, customer_phone: null });
    expect((await entry(recent.ticketId)).customer_name).toBe('Recent');
    expect((await entry(active.ticketId)).customer_phone).toBe('9876543210');
  });

  it("cancels entries stranded on a past day's queue, then anonymizes them", async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId);
    await plantLegacyPersonalData(t.ticketId, 'Stranded', '9876543210');
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await supabase.from('queues').update({ date: yesterday }).eq('salon_id', salonId);

    await supabase.rpc('cleanup_customer_data', { p_retention_hours: 24 });
    const first = await entry(t.ticketId);
    expect(first.status).toBe('CANCELLED');
    expect(first.customer_name).toBe('Stranded');

    await supabase.rpc('cleanup_customer_data', { p_retention_hours: 0 });
    const second = await entry(t.ticketId);
    expect(second.customer_name).toBeNull();
    expect(second.customer_phone).toBeNull();
  });
});