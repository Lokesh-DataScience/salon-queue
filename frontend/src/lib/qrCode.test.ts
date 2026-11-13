import { describe, it, expect } from 'vitest';
import { salonCodeFromQr } from './qrCode';

describe('salonCodeFromQr', () => {
  it('takes the code out of a wall-QR link, from any host', () => {
    expect(salonCodeFromQr('https://salonqueue.example.in/q/696C52070495')).toBe('696c52070495');
    expect(salonCodeFromQr('http://localhost:5173/q/abcdef123456/')).toBe('abcdef123456');
  });

  it('refuses anything that is not a wall-QR link', () => {
    for (const text of [
      'hello',
      'https://example.com/',
      'https://example.com/tickets/t1?accessToken=x',
      'https://example.com/q/short',
      'https://example.com/q/abc/def',
      'javascript:alert(1)//q/abcdef123456',
      'upi://pay?pa=x@y',
    ]) {
      expect(salonCodeFromQr(text), text).toBeNull();
    }
  });
});
