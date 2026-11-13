import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CustomerChrome, { showsBottomNav } from './CustomerChrome';
import { resetLangForTests } from '../lib/i18n';

beforeEach(() => {
  localStorage.clear();
  resetLangForTests();
});

describe('bottom bar, slice 4', () => {
  it('has four tabs: salons, tokens, scan, history', () => {
    render(
      <MemoryRouter initialEntries={['/c/history']}>
        <CustomerChrome />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/c', '/c/tokens', '/c/scan', '/c/history']);
    expect(screen.getByRole('link', { name: /इतिहास/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /QR स्कैन/ })).not.toHaveAttribute('aria-current');
  });

  it('shows on the scan and history pages', () => {
    expect(showsBottomNav('/c/scan', false)).toBe(true);
    expect(showsBottomNav('/c/history', false)).toBe(true);
  });
});
