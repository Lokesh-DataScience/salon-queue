// backend/tests/ticketSalon.test.ts — Customer app fix: the ticket tells its holder which salon it is,
// so opening a ticket in any browser (or in the installed app) can add the salon to "My salons".
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, joinViaApi } from './helpers';
import { supabase } from '../src/config/supabase';

afterAll(cleanupSalons);

describe('Ticket status carries the salon name and QR code (for "My salons")', () => {
  it('the ticket holder gets them', async () => {
    const salonId = await makeSalon({ name: 'Ticket Salon Test' });
    const { data: salon } = await supabase.from('salons').select('qr_code').eq('id', salonId).single();
    const t = (await joinViaApi(salonId)).body.ticket;

    const res = await request(app).get(`/api/queue-tickets/${t.ticketId}`).set('X-Ticket-Token', t.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.ticket).toMatchObject({ salonId, salonName: 'Ticket Salon Test', salonCode: salon!.qr_code });
  }, 60_000);

  it('a finished ticket still has them (that is when the app needs them)', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId)).body.ticket;
    await supabase.from('queue_entries').update({ status: 'COMPLETED', completed_at: new Date().toISOString() }).eq('id', t.ticketId);

    const res = await request(app).get(`/api/queue-tickets/${t.ticketId}`).set('X-Ticket-Token', t.accessToken);
    expect(res.body.ticket.status).toBe('COMPLETED');
    expect(res.body.ticket.salonCode).toMatch(/^[a-z0-9]{8,32}$/);
  }, 60_000);

  it('a wrong token gets nothing, and the public salon routes still never show the code', async () => {
    const salonId = await makeSalon();
    const { data: salon } = await supabase.from('salons').select('qr_code').eq('id', salonId).single();
    const t = (await joinViaApi(salonId)).body.ticket;

    const wrong = await request(app).get(`/api/queue-tickets/${t.ticketId}`).set('X-Ticket-Token', 'x'.repeat(40));
    expect(wrong.status).toBe(404);
    expect(JSON.stringify(wrong.body)).not.toContain(salon!.qr_code);

    for (const url of [`/api/salons/${salonId}`, `/api/salons/${salonId}/queue-public`, `/api/salons/${salonId}/queue`]) {
      expect(JSON.stringify((await request(app).get(url)).body), url).not.toContain(salon!.qr_code);
    }
  }, 60_000);
});
