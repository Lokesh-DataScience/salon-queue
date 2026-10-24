import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, joinViaApi } from './helpers';

afterAll(cleanupSalons);

describe('Ticket token in a header', () => {
  it('is accepted from X-Ticket-Token, and wrong or missing tokens are refused', async () => {
    const salonId = await makeSalon();
    const t = (await joinViaApi(salonId, 'Header')).body.ticket;
    const url = `/api/queue-tickets/${t.ticketId}`;

    expect((await request(app).get(url).set('X-Ticket-Token', t.accessToken)).status).toBe(200);
    expect((await request(app).get(url).set('X-Ticket-Token', 'x'.repeat(40))).status).toBe(404);
    expect((await request(app).get(url)).status).toBe(400);
  });
});