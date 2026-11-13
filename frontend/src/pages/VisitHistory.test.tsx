import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VisitHistory from './VisitHistory';
import MyTickets from './MyTickets';
import { renderPage } from '../test/utils';
import { getVisits, recordVisit } from '../lib/visitHistory';
import { resetLangForTests } from '../lib/i18n';
import * as tickets from '../api/tickets';

vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  resetLangForTests();
});

describe('History page', () => {
  it('starts empty', () => {
    renderPage(<VisitHistory />, { path: '/c/history', route: '/c/history' });
    expect(screen.getByText('अभी कोई इतिहास नहीं')).toBeInTheDocument();
  });

  it('lists visits newest first, with the outcome, and links back to the salon', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T05:00:00Z'));
    recordVisit({ ticketId: 'a', salonId: 's1', salonName: 'Milan Hair Salon', salonCode: 'abcdef123456', tokenNumber: 4, status: 'COMPLETED' });
    vi.setSystemTime(new Date('2026-11-13T07:00:00Z'));
    recordVisit({ ticketId: 'b', salonId: 's2', salonName: 'Raja Salon', tokenNumber: 9, status: 'CANCELLED' });
    vi.useRealTimers();

    renderPage(<VisitHistory />, { path: '/c/history', route: '/c/history' });
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Raja Salon');
    expect(items[0]).toHaveTextContent('टोकन #9');
    expect(items[0]).toHaveTextContent('आपने लाइन छोड़ी');
    expect(within(items[0]).queryByRole('link')).not.toBeInTheDocument(); // no code saved: nothing to open
    expect(within(items[1]).getByRole('link')).toHaveAttribute('href', '/c/s/abcdef123456');
    expect(items[1]).toHaveTextContent('सेवा पूरी हुई');
  });

  it('clears only after confirming', async () => {
    recordVisit({ ticketId: 'a', salonId: 's1', salonName: 'Milan', tokenNumber: 4, status: 'COMPLETED' });
    const user = userEvent.setup();
    renderPage(<VisitHistory />, { path: '/c/history', route: '/c/history' });
    await user.click(screen.getByRole('button', { name: 'इतिहास मिटाएँ' }));
    await user.click(screen.getByRole('button', { name: 'रहने दें' }));
    expect(getVisits()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'इतिहास मिटाएँ' }));
    await user.click(screen.getByRole('button', { name: 'हाँ, मिटाएँ' }));
    expect(getVisits()).toHaveLength(0);
    expect(screen.getByText('अभी कोई इतिहास नहीं')).toBeInTheDocument();
  });
});

describe('a token that finished while its page was closed', () => {
  it('moves into history when the Tokens tab finds it finished', async () => {
    localStorage.setItem(
      'svq.tickets.v1',
      JSON.stringify([{ ticketId: 't5', accessToken: 'x'.repeat(40), salonId: 's1', tokenNumber: 5, savedAt: Date.now() }]),
    );
    vi.mocked(tickets.fetchTicketStatus).mockResolvedValue({
      status: 'COMPLETED', salonName: 'Milan Hair Salon', salonCode: 'abcdef123456',
    });
    renderPage(<MyTickets />, { path: '/c/tokens', route: '/c/tokens' });
    expect(await screen.findByText('अभी कोई टोकन नहीं')).toBeInTheDocument();
    expect(getVisits()).toEqual([
      expect.objectContaining({ ticketId: 't5', tokenNumber: 5, outcome: 'COMPLETED', salonCode: 'abcdef123456' }),
    ]);
  });
});
