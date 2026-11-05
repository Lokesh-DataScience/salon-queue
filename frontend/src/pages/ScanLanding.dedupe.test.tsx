// frontend/src/pages/ScanLanding.dedupe.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanLanding from './ScanLanding';
import { renderPage } from '../test/utils';
import * as salons from '../api/salons';
import * as tickets from '../api/tickets';

vi.mock('../api/salons', () => ({ fetchSalonByCode: vi.fn() }));
vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn(), joinSalonQueue: vi.fn() }));
vi.mock('../api/publicServices', () => ({ fetchSalonServices: vi.fn().mockResolvedValue([]) }));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(salons.fetchSalonByCode).mockReset().mockResolvedValue({ id: 'salon-1', name: 'Style Studio' });
  vi.mocked(tickets.fetchTicketStatus).mockReset();
  vi.mocked(tickets.joinSalonQueue).mockReset();
});

describe('ScanLanding: one scan, one ticket', () => {
  it('retries with the SAME key after a failure, then forgets the key once the ticket is saved', async () => {
    vi.mocked(tickets.joinSalonQueue)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ticketId: 't1', accessToken: 'a'.repeat(64), salonId: 'salon-1', tokenNumber: 1 });
    const user = userEvent.setup();
    renderPage(<ScanLanding />, { path: '/q/:code', route: '/q/abcdefabcdef' });

    await user.click(await screen.findByRole('button', { name: /try again/i }));
    await screen.findByText('OTHER PAGE'); // navigated to the ticket

    const calls = vi.mocked(tickets.joinSalonQueue).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toMatch(/^[a-f0-9]{32}$/);
    expect(calls[1][1]).toBe(calls[0][1]);
    expect(localStorage.getItem('joinKey:salon-1')).toBeNull();
  });
});