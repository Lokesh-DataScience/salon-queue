// frontend/src/components/BarberLayout.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BarberLayout from './BarberLayout';
import * as barber from '../api/barber';

vi.mock('../api/barber', () => ({ fetchBarberSalon: vi.fn() }));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/barber/login" element={<p>LOGIN PAGE</p>} />
          <Route element={<BarberLayout />}>
            <Route path="/barber/dashboard" element={<p>DASH CONTENT</p>} />
            <Route path="/barber/settings" element={<p>SETTINGS CONTENT</p>} />
            <Route path="/barber/offers" element={<p>OFFERS CONTENT</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(barber.fetchBarberSalon).mockReset();
  vi.mocked(barber.fetchBarberSalon).mockResolvedValue({} as never);
});

describe('BarberLayout', () => {
  it('shows exactly two tabs and marks Dashboard as current', async () => {
    renderAt('/barber/dashboard');
    expect(await screen.findByText('DASH CONTENT')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.querySelectorAll('a')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Settings highlighted on pages that live under it', async () => {
    renderAt('/barber/offers');
    expect(await screen.findByText('OFFERS CONTENT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('sends a logged-out visitor to login', async () => {
    vi.mocked(barber.fetchBarberSalon).mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));
    renderAt('/barber/settings');
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument();
  });
});