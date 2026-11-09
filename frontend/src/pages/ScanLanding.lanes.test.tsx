// frontend/src/pages/ScanLanding.lanes.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ScanLanding from './ScanLanding';
import { saveRememberToken } from '../lib/rememberToken';

vi.mock('../lib/push', () => ({
  askPushPermission: () => Promise.resolve('denied'),
  enablePushAfterJoin: () => Promise.resolve(),
}));

const TWO_BARBERS = [
  { id: 'lane-owner', name: 'Owner', waitingCount: 2, estimatedWaitMinutes: 25 },
  { id: 'lane-rahul', name: 'Rahul', waitingCount: 0, estimatedWaitMinutes: 0 },
];

let joinBodies: Record<string, unknown>[] = [];

function mockServer(opts: { lanes?: unknown; lanesFail?: boolean; joinStatus?: number; joinMessage?: string } = {}) {
  joinBodies = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/api/salons/by-code/')) return json({ salon: { id: 's1', name: 'Style Studio' } });
    if (url.endsWith('/services')) return json({ services: [] });
    if (url.endsWith('/lanes')) return opts.lanesFail ? json({ message: 'boom' }, 500) : json({ lanes: opts.lanes ?? [] });
    if (url.includes('/api/queues/s1/join')) {
      joinBodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (opts.joinStatus && opts.joinStatus !== 201) return json({ message: opts.joinMessage }, opts.joinStatus);
      return json({ ticket: { ticketId: 't1', accessToken: 'x'.repeat(64), salonId: 's1', tokenNumber: 7 } }, 201);
    }
    return json({ message: 'not found' }, 404);
  }));
}

function renderScan() {
  return render(
    <MemoryRouter initialEntries={['/q/abcdefgh']}>
      <Routes>
        <Route path="/q/:code" element={<ScanLanding />} />
        <Route path="/tickets/:ticketId" element={<p>TICKET PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  // These tests are about choosing a barber, so this phone is already known to the salon
  // (the first-visit details form is covered in ScanLanding.customer.test.tsx).
  saveRememberToken('s1', 'f'.repeat(64));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ScanLanding with several barbers', () => {
  it('a salon with one barber joins straight away, with no choice and no laneId', async () => {
    mockServer({ lanes: [TWO_BARBERS[0]] });
    renderScan();
    expect(await screen.findByText('TICKET PAGE')).toBeTruthy();
    expect(joinBodies).toHaveLength(1);
    expect(joinBodies[0]).not.toHaveProperty('laneId');
  });

  it('if the barber list cannot be loaded, the customer still gets a token', async () => {
    mockServer({ lanesFail: true });
    renderScan();
    expect(await screen.findByText('TICKET PAGE')).toBeTruthy();
    expect(joinBodies[0]).not.toHaveProperty('laneId');
  });

  it('two barbers: shows the choice, "Any barber" is preselected and sends no laneId', async () => {
    mockServer({ lanes: TWO_BARBERS });
    renderScan();
    expect(await screen.findByRole('group', { name: 'Choose your barber' })).toBeTruthy();
    expect((screen.getByLabelText(/Any barber/) as HTMLInputElement).checked).toBe(true);
    expect(joinBodies).toHaveLength(0); // nothing is joined until the customer taps

    fireEvent.click(screen.getByRole('button', { name: 'Get my token' }));
    expect(await screen.findByText('TICKET PAGE')).toBeTruthy();
    expect(joinBodies).toHaveLength(1);
    expect(joinBodies[0]).not.toHaveProperty('laneId');
  });

  it('choosing a barber sends that barber\'s lane', async () => {
    mockServer({ lanes: TWO_BARBERS });
    renderScan();
    fireEvent.click(await screen.findByLabelText(/Rahul/));
    fireEvent.click(screen.getByRole('button', { name: 'Get my token' }));
    expect(await screen.findByText('TICKET PAGE')).toBeTruthy();
    expect(joinBodies[0].laneId).toBe('lane-rahul');
  });

  it('if the chosen barber was switched off meanwhile, the list refreshes with a clear message', async () => {
    mockServer({ lanes: TWO_BARBERS, joinStatus: 409, joinMessage: "That barber isn't available right now. Please choose again." });
    renderScan();
    fireEvent.click(await screen.findByLabelText(/Rahul/));
    fireEvent.click(screen.getByRole('button', { name: 'Get my token' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("isn't available"));
    expect(screen.queryByText('TICKET PAGE')).toBeNull();
    expect(screen.getByRole('group', { name: 'Choose your barber' })).toBeTruthy(); // can choose again
  });
});