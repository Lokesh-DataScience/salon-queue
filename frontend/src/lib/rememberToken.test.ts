// frontend/src/lib/rememberToken.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { clearRememberToken, getRememberToken, saveRememberToken } from './rememberToken';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

beforeEach(() => localStorage.clear());

describe('rememberToken', () => {
  it('remembers a token per salon, and one salon never sees another salon\'s', () => {
    saveRememberToken('salon-1', A);
    expect(getRememberToken('salon-1')).toBe(A);
    expect(getRememberToken('salon-2')).toBeNull();
    saveRememberToken('salon-2', B);
    expect(getRememberToken('salon-1')).toBe(A);
    expect(getRememberToken('salon-2')).toBe(B);
  });

  it('clearing one salon leaves the others', () => {
    saveRememberToken('salon-1', A);
    saveRememberToken('salon-2', B);
    clearRememberToken('salon-1');
    expect(getRememberToken('salon-1')).toBeNull();
    expect(getRememberToken('salon-2')).toBe(B);
  });

  it('replaces the token when the server issues a new one', () => {
    saveRememberToken('salon-1', A);
    saveRememberToken('salon-1', B);
    expect(getRememberToken('salon-1')).toBe(B);
  });

  it('ignores anything that is not a token (so a name or phone can never be stored here)', () => {
    saveRememberToken('salon-1', '9876543210');
    saveRememberToken('salon-1', 'Ravi Kumar');
    expect(getRememberToken('salon-1')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('stores nothing but the token', () => {
    saveRememberToken('salon-1', A);
    const raw = JSON.stringify(Object.fromEntries(Object.entries(localStorage)));
    expect(raw).toContain(A);
    expect(raw).not.toMatch(/phone|name/i);
  });

  it('survives a corrupt value, and keeps only the 20 newest salons', () => {
    localStorage.setItem('svq.remember.v1', '{not json');
    expect(getRememberToken('salon-1')).toBeNull();
    localStorage.clear();
    for (let i = 0; i < 25; i++) saveRememberToken(`salon-${i}`, A);
    expect(getRememberToken('salon-0')).toBeNull();
    expect(getRememberToken('salon-24')).toBe(A);
  });
});