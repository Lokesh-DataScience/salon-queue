// backend/tests/helpers.ts
import request from 'supertest';
import { supabase } from '../src/config/supabase';
import { createApp } from '../src/app';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

export const app = createApp();

const createdSalonIds: string[] = [];

export async function makeSalon(overrides: Record<string, unknown> = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await supabase
      .from('salons')
      .insert({
        name: 'TEST Salon (safe to delete)',
        phone: '0000000000',
        address: 'Test Street',
        latitude: 23.2599,
        longitude: 77.4126,
        opening_time: '00:00',
        closing_time: '23:59',
        average_service_minutes: 10,
        ...overrides,
      })
      .select('id')
      .single();

    if (!error && data) {
      createdSalonIds.push(data.id);
      return data.id as string;
    }
    // Retry only network-level failures. Real database errors should fail loudly.
    const transient = String(error?.message).includes('fetch failed');
    if (!transient || attempt === 3) throw new Error(`makeSalon failed: ${error?.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw new Error('unreachable');
}

// Deleting the salon cascades to its queues and entries.
export async function cleanupSalons() {
  if (createdSalonIds.length === 0) return;
  await supabase.from('salons').delete().in('id', createdSalonIds);
  createdSalonIds.length = 0;
}

export function joinViaApi(salonId: string) {
  return request(app).post(`/api/queues/${salonId}/join`).send({});
}

// Simulates a row created before anonymous joins, to prove nothing leaks it.
export async function plantLegacyPersonalData(entryId: string, name: string, phone: string) {
  const { error } = await supabase
    .from('queue_entries')
    .update({ customer_name: name, customer_phone: phone })
    .eq('id', entryId);
  if (error) throw new Error(`plantLegacyPersonalData failed: ${error.message}`);
}

export async function barberCookieFor(salonId: string): Promise<string> {
  const email = `barber-${randomUUID()}@example.test`;
  const password = 'testpass123';
  const { error } = await supabase.from('salon_staff').insert({
    salon_id: salonId,
    name: 'Test Barber',
    email,
    password_hash: await bcrypt.hash(password, 4),
    role: 'BARBER',
  });
  if (error) throw new Error(`barberCookieFor insert failed: ${error.message}`);

  const res = await request(app).post('/api/auth/barber/login').send({ email, password });
  if (res.status !== 200) throw new Error(`barberCookieFor login failed: ${res.status}`);
  const lines = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  const access = lines.find((c) => c.startsWith('access_token=') && !c.startsWith('access_token=;'));
  if (!access) throw new Error('barberCookieFor: no access_token cookie');
  return access.split(';')[0];
}