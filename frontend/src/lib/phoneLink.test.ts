import { describe, it, expect } from 'vitest';
import { telHref, formatPhone, displayPhone } from './phoneLink';

describe('phoneLink', () => {
  it('dials a 10-digit mobile with +91', () => {
    expect(telHref('9876543210')).toBe('tel:+919876543210');
  });
  it('leaves other numbers dialable and strips spaces and dashes', () => {
    expect(telHref('+91 98765-43210')).toBe('tel:+919876543210');
    expect(telHref('0771 2345678')).toBe('tel:07712345678');
  });
  it('shows a 10-digit mobile in two groups, anything else untouched', () => {
    expect(formatPhone('9876543210')).toBe('98765 43210');
    expect(formatPhone('+91 98765 43210')).toBe('+91 98765 43210');
  });

  it('displays a salon number the way it is stored, grouped', () => {
    expect(displayPhone('+919876543210')).toBe('+91 98765 43210');
    expect(displayPhone('9876543210')).toBe('98765 43210');
    expect(displayPhone('+91 98765-43210')).toBe('+91 98765 43210');
    expect(displayPhone('0771 2345678')).toBe('0771 2345678');
  });
});