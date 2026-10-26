import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Keep the real socket out of these routing tests.
vi.mock('./lib/socket', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), connected: false },
}));

async function renderApp(route: string) {
  const { default: App } = await import('./App');
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('customer routes with discovery switched off (default)', () => {
  it('home asks the customer to scan the salon QR code', async () => {
    await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Scan the QR code at the salon' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /find a salon/i })).not.toBeInTheDocument();
  });

  it.each(['/salons', '/salons/abc', '/salons/abc/join'])('%s redirects home', async (path) => {
    await renderApp(path);
    expect(await screen.findByRole('heading', { name: 'Scan the QR code at the salon' })).toBeInTheDocument();
  });

  it('the QR landing route exists', async () => {
    await renderApp('/q/87bcee043619');
    expect(await screen.findByText(/Getting your token|QR code not recognised|couldn't open|Can't get a token/i)).toBeInTheDocument();
  });
});

describe('customer routes with discovery switched on', () => {
  it('brings the original home page back', async () => {
    vi.stubEnv('VITE_CUSTOMER_DISCOVERY', 'true');
    await renderApp('/');
    expect(await screen.findByRole('link', { name: /find a salon near me/i })).toBeInTheDocument();
  });
});
