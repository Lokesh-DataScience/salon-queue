import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyTickets from './MyTickets';
import { resetLangForTests } from '../lib/i18n';
import * as tickets from '../api/tickets';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/c/tokens']}>
        <MyTickets />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function storeTicket(id: string, tokenNumber: number, salonId = 's1') {
  const list = JSON.parse(localStorage.getItem('svq.tickets.v1') ?? '[]');
  list.push({ ticketId: id, accessToken: `tok-${id}`, salonId, tokenNumber, savedAt: Date.now() });
  localStorage.setItem('svq.tickets.v1', JSON.stringify(list));
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetLangForTests();
});

describe('MyTickets', () => {
  it('shows the empty state when the phone holds no tokens', () => {
    renderPage();
    expect(screen.getByText('अभी कोई टोकन नहीं')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'मेरे सैलून देखें' })).toHaveAttribute('href', '/c');
  });

  it('lists live tokens with their salon and position', async () => {
    localStorage.setItem(
      'svq.mysalons.v1',
      JSON.stringify([{ salonId: 's1', code: 'abcd1234', name: 'Raja Salon', lastVisitedAt: Date.now() }]),
    );
    storeTicket('t1', 27);
    vi.spyOn(tickets, 'fetchTicketStatus').mockResolvedValue({
      status: 'WAITING',
      peopleAhead: 3,
      estimatedWaitMinutes: 25,
    });

    renderPage();
    const card = await screen.findByRole('link', { name: /#27/ });
    expect(card).toHaveTextContent('Raja Salon');
    expect(card).toHaveTextContent('3 लोग आगे · ~25 मिनट');
    expect(card).toHaveAttribute('href', '/tickets/t1?accessToken=tok-t1');
  });

  it("marks a called token as the customer's turn", async () => {
    storeTicket('t2', 31);
    vi.spyOn(tickets, 'fetchTicketStatus').mockResolvedValue({ status: 'CALLED', peopleAhead: 0, estimatedWaitMinutes: 0 });
    renderPage();
    expect(await screen.findByText(/आपकी बारी है/)).toBeInTheDocument();
  });

  it('drops a finished token from the list', async () => {
    storeTicket('t3', 12);
    vi.spyOn(tickets, 'fetchTicketStatus').mockResolvedValue({ status: 'COMPLETED', peopleAhead: 0, estimatedWaitMinutes: 0 });
    renderPage();
    expect(await screen.findByText('अभी कोई टोकन नहीं')).toBeInTheDocument();
  });
});
