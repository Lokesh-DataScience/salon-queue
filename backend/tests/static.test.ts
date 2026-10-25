import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../src/app';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svq-client-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>SPA SHELL</title>');
  fs.writeFileSync(path.join(dir, 'sw.js'), '// service worker');
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *\nDisallow: /tickets/\n');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Serving the frontend from the backend', () => {
  it('returns the app for page URLs, including deep links with a ticket token', async () => {
    const app = createApp({ clientDir: dir });
    for (const url of ['/', '/salons', '/tickets/abc?accessToken=xyz', '/barber/dashboard']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.text).toContain('SPA SHELL');
    }
  });

  it('never answers an API path with the app', async () => {
    const res = await request(createApp({ clientDir: dir })).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found.' });
  });

  it('caches hashed assets for a year but never the service worker or the app page', async () => {
    const app = createApp({ clientDir: dir });
    expect((await request(app).get('/assets/app-abc123.js')).headers['cache-control']).toMatch(/immutable/);
    expect((await request(app).get('/sw.js')).headers['cache-control']).toBe('no-cache');
    expect((await request(app).get('/')).headers['cache-control']).toBe('no-cache');
  });

  it('sends a content security policy that allows same-origin scripts and websockets', async () => {
    const res = await request(createApp({ clientDir: dir })).get('/');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).toMatch(/connect-src 'self' wss:/);
  });

  it('refuses to start when asked to serve a frontend that is not built', () => {
    expect(() => createApp({ clientDir: path.join(dir, 'missing') })).toThrow(/Build the frontend/);
  });

  it('serves nothing but the API when no frontend is configured (local development)', async () => {
    const res = await request(createApp()).get('/tickets/abc');
    expect(res.status).toBe(404);
  });
  it('serves a real robots.txt and keeps private pages out of search engines', async () => {
    const app = createApp({ clientDir: dir });
    const robots = await request(app).get('/robots.txt');
    expect(robots.headers['content-type']).toMatch(/text\/plain/);
    expect(robots.text).toContain('Disallow: /tickets/');
    expect((await request(app).get('/tickets/abc?accessToken=x')).headers['x-robots-tag']).toMatch(/noindex/);
    expect((await request(app).get('/barber/dashboard')).headers['x-robots-tag']).toMatch(/noindex/);
    expect((await request(app).get('/salons')).headers['x-robots-tag']).toBeUndefined();
  });
});