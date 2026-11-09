// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup} from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BarberLayout from './BarberLayout';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockMe(role: 'OWNER' | 'BARBER') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ staff: { id: '1', name: 'X', role, salonId: 's', laneId: 'l', laneName: 'Main' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } })));
}
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<BarberLayout />}>
            <Route path="/barber/dashboard" element={<p>DASH PAGE</p>} />
            <Route path="/barber/settings" element={<p>SETTINGS PAGE</p>} />
            <Route path="/barber/stats" element={<p>STATS PAGE</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>);
}

describe('BarberLayout role gating', () => {
  it('owner sees Dashboard, Customers and Settings, and can open Settings', async () => {
    mockMe('OWNER');
    renderAt('/barber/settings');
    expect(await screen.findByText('SETTINGS PAGE')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Customers/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Settings/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Log out/ })).toBeNull();
  });

  it('staff see only the Dashboard plus a Log out button', async () => {
    mockMe('BARBER');
    renderAt('/barber/dashboard');
    expect(await screen.findByText('DASH PAGE')).toBeTruthy();
    await screen.findByRole('button', { name: /Log out/ });
    expect(screen.queryByRole('link', { name: /Customers/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Settings/ })).toBeNull();
  });

  it('staff who type the Settings or Customers URL land on the Dashboard instead', async () => {
    for (const p of ['/barber/settings', '/barber/stats']) {
      mockMe('BARBER');
      renderAt(p);
      expect(await screen.findByText('DASH PAGE')).toBeTruthy();
      expect(screen.queryByText('SETTINGS PAGE')).toBeNull();
      expect(screen.queryByText('STATS PAGE')).toBeNull();
      cleanup();
    }
  });

  it('owner pages never flash for staff while the role is still loading', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
    renderAt('/barber/settings');
    expect(screen.queryByText('SETTINGS PAGE')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading');
  });
});