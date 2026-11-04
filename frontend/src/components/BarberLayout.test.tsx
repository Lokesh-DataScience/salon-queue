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
            <Route path="/barber/stats" element={<p>STATS CONTENT</p>} />
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
  it('shows three tabs in order and marks Dashboard as current', async () => {
    renderAt('/barber/dashboard');
    expect(await screen.findByText('DASH CONTENT')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = nav.querySelectorAll('a');
    expect(links).toHaveLength(3);
    expect(Array.from(links).map((a) => a.textContent)).toEqual(['Dashboard', 'Customers', 'Settings']);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Customers' })).not.toHaveAttribute('aria-current');
  });

  it('marks Customers as current on the stats page', async () => {
    renderAt('/barber/stats');
    expect(await screen.findByText('STATS CONTENT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute('aria-current', 'page');
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