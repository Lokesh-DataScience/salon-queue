// backend/tests/retention.test.ts  (spec §51 test 5)
import { describe, it, expect, afterAll } from 'vitest';
import { makeSalon, cleanupSalons } from './helpers';
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

describe('Test 5: retention cleanup', () => {
  it('deletes name and phone from old finished entries only', async () => {
    const salonId = await makeSalon();
    const old = await joinQueue(salonId, 'Old Customer', '9876543210');
    const recent = await joinQueue(salonId, 'Recent Customer', '9876543210');
    const active = await joinQueue(salonId, 'Active Customer', '9876543210');

    await supabase.from('queue_entries').update({ status: 'COMPLETED', completed_at: hoursAgo(48) }).eq('id', old.ticketId);
    await supabase.from('queue_entries').update({ status: 'COMPLETED', completed_at: hoursAgo(1) }).eq('id', recent.ticketId);

    const { error } = await supabase.rpc('cleanup_customer_data', { p_retention_hours: 24 });
    expect(error).toBeNull();

    const o = await entry(old.ticketId);
    expect(o).toMatchObject({ token_number: 1, status: 'COMPLETED', customer_name: null, customer_phone: null });

    expect((await entry(recent.ticketId)).customer_name).toBe('Recent Customer'); // inside window
    expect((await entry(active.ticketId)).customer_phone).toBe('9876543210'); // active: never touched
  });

  it("cancels entries stranded on a past day's queue, then anonymizes them", async () => {
    const salonId = await makeSalon();
    const t = await joinQueue(salonId, 'Stranded', '9876543210');
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await supabase.from('queues').update({ date: yesterday }).eq('salon_id', salonId);

    await supabase.rpc('cleanup_customer_data', { p_retention_hours: 24 });
    const afterFirst = await entry(t.ticketId);
    expect(afterFirst.status).toBe('CANCELLED');
    expect(afterFirst.customer_name).toBe('Stranded'); // retention window starts now

    await supabase.rpc('cleanup_customer_data', { p_retention_hours: 0 });
    const afterSecond = await entry(t.ticketId);
    expect(afterSecond.customer_name).toBeNull();
    expect(afterSecond.customer_phone).toBeNull();
  });
});