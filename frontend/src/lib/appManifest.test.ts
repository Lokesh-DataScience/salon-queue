// frontend/src/lib/appManifest.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyManifest, manifestFor, BARBER_MANIFEST, CUSTOMER_MANIFEST } from './appManifest';

const href = () => document.querySelector('link[rel="manifest"]')?.getAttribute('href');

beforeEach(() => {
  document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest" />';
});

describe('appManifest', () => {
  it('barber pages keep the barber app; every customer page gets the customer app', () => {
    for (const p of ['/barber', '/barber/dashboard', '/barber/settings/profile']) expect(manifestFor(p), p).toBe(BARBER_MANIFEST);
    for (const p of ['/', '/c', '/c/', '/c/s/abc', '/q/abc123', '/tickets/t1', '/barbershop']) {
      expect(manifestFor(p), p).toBe(CUSTOMER_MANIFEST);
    }
  });

  it('switches the existing link in place, and back', () => {
    applyManifest('/tickets/t1');
    expect(href()).toBe(CUSTOMER_MANIFEST);
    applyManifest('/barber/dashboard');
    expect(href()).toBe(BARBER_MANIFEST);
    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);
  });

  it('adds the link if the page has none', () => {
    document.head.innerHTML = '';
    applyManifest('/c');
    expect(href()).toBe(CUSTOMER_MANIFEST);
  });
});
