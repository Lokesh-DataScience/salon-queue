import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Request, Response } from 'express';
import { createApp } from '../src/app';
import { errorHandler } from '../src/middleware/errorHandler';

const FAKE_SALON = '00000000-0000-0000-0000-000000000000';

describe('Rate limiting', () => {
  it('blocks the 21st join from one IP', async () => {
    const app = createApp({ rateLimits: true }); // fresh counters
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) {
      // Empty body fails validation (400) before touching the DB, but still counts toward the limit.
      codes.push((await request(app).post(`/api/queues/${FAKE_SALON}/join`).send({})).status);
    }
    expect(codes.slice(0, 20).every((c) => c !== 429)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  it('blocks the 11th failed login', async () => {
    const app = createApp({ rateLimits: true });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await request(app).post('/api/auth/barber/login').send({})).status);
    }
    expect(codes.slice(0, 10).every((c) => c !== 429)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('returns the same {message} shape the frontend reads', async () => {
    const app = createApp({ rateLimits: true });
    for (let i = 0; i < 10; i++) await request(app).post('/api/auth/barber/login').send({});
    const blocked = await request(app).post('/api/auth/barber/login').send({});
    expect(blocked.status).toBe(429);
    expect(typeof blocked.body.message).toBe('string');
  });
});

describe('Error handling', () => {
  it('answers malformed JSON with 400, not 500', async () => {
    const res = await request(createApp())
      .post(`/api/queues/${FAKE_SALON}/join`)
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid request.');
  });

  it('never logs the contents of an unhandled error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const PHONE = '9123456780';
    const dbError = Object.assign(new Error(`duplicate key (customer_phone)=(${PHONE})`), {
      name: 'PostgrestError',
      code: '23505',
      details: `Key (customer_phone)=(${PHONE}) already exists.`,
    });
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Response;

    errorHandler(dbError, { method: 'POST', path: '/api/queues/x/join' } as Request, res, vi.fn());

    const output = spy.mock.calls.map((a) => a.map(String).join(' ')).join('\n');
    spy.mockRestore();
    expect(output).toContain('23505');
    expect(output).not.toContain(PHONE);
    expect(json).toHaveBeenCalledWith({ message: 'Something went wrong. Please try again.' });
  });
});