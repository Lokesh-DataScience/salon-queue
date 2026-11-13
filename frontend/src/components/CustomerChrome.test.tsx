import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CustomerChrome, { isCustomerPath, showsBottomNav } from './CustomerChrome';
import { resetLangForTests, setLang } from '../lib/i18n';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CustomerChrome />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetLangForTests();
  document.body.className = '';
});

describe('showsBottomNav', () => {
  it('shows the bar on the customer-app pages', () => {
    expect(showsBottomNav('/c', false)).toBe(true);
    expect(showsBottomNav('/c/', false)).toBe(true);
    expect(showsBottomNav('/c/tokens', false)).toBe(true);
    expect(showsBottomNav('/c/s/abcd1234', false)).toBe(true);
  });

  it('hides it during the join flow and on wall-QR pages', () => {
    expect(showsBottomNav('/c/s/abcd1234/join', false)).toBe(false);
    expect(showsBottomNav('/q/abcd1234', false)).toBe(false);
    expect(showsBottomNav('/', false)).toBe(false);
  });

  it('shows it on a ticket page only inside the installed app', () => {
    expect(showsBottomNav('/tickets/t1', false)).toBe(false);
    expect(showsBottomNav('/tickets/t1', true)).toBe(true);
  });

  it('treats every /barber page as not a customer page', () => {
    expect(isCustomerPath('/barber/dashboard')).toBe(false);
    expect(isCustomerPath('/barber')).toBe(false);
    expect(isCustomerPath('/barbers-near-me')).toBe(true);
  });
});

describe('CustomerChrome', () => {
  it('renders the Hindi bar with the current tab marked', () => {
    renderAt('/c/tokens');
    expect(screen.getByRole('navigation', { name: 'मुख्य मेनू' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /टोकन/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /सैलून/ })).not.toHaveAttribute('aria-current');
    expect(document.body).toHaveClass('c-font', 'has-c-nav');
    expect(document.documentElement.lang).toBe('hi');
  });

  it('switches the bar to English', () => {
    renderAt('/c');
    act(() => setLang('en'));
    expect(screen.getByRole('link', { name: /Salons/ })).toHaveAttribute('aria-current', 'page');
    expect(document.documentElement.lang).toBe('en');
  });

  it('leaves barber pages alone', () => {
    const { container } = renderAt('/barber/dashboard');
    expect(container).toBeEmptyDOMElement();
    expect(document.body).not.toHaveClass('c-font');
    expect(document.body).not.toHaveClass('has-c-nav');
  });

  it('shows the offline strip when the connection drops', () => {
    renderAt('/c');
    expect(screen.queryByText(/इंटरनेट बंद है/)).not.toBeInTheDocument();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('इंटरनेट बंद है');
  });
});
