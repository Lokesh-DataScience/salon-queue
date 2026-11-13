// frontend/src/pages/MyTickets.tsx
// Customer app "Tokens" tab (/c/tokens): every live token on this phone, across salons.
// Uses the same saved tickets and the same ['ticket', id] cache as the ticket page.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import Icon from '../components/Icon';
import { useActiveTickets, type ActiveTicket } from '../hooks/useActiveTickets';
import { getMySalons } from '../lib/mySalons';
import { useT } from '../lib/i18n';

const ticketUrl = (ticketId: string, accessToken: string) => `/tickets/${ticketId}?accessToken=${accessToken}`;

const TEXT = {
  hi: {
    title: 'मेरे टोकन',
    yourTurn: 'आपकी बारी है — काउंटर पर जाएँ',
    serving: 'आपकी सेवा चल रही है',
    next: 'आप अगले हैं — सैलून की ओर चलें',
    ahead: (n: number, m: number) => `${n} लोग आगे · ~${m} मिनट`,
    unknown: 'स्थिति अभी नहीं मिली',
    salon: 'सैलून',
    checking: 'टोकन देख रहे हैं...',
    emptyTitle: 'अभी कोई टोकन नहीं',
    emptyBody: 'किसी सैलून से टोकन लें, वह यहाँ दिखेगा।',
    seeSalons: 'मेरे सैलून देखें',
  },
  en: {
    title: 'My tokens',
    yourTurn: "It's your turn — go to the counter",
    serving: 'Your service is in progress',
    next: "You're next — head to the salon",
    ahead: (n: number, m: number) => `${n} ahead · ~${m} min`,
    unknown: "Couldn't check the status",
    salon: 'Salon',
    checking: 'Checking your tokens...',
    emptyTitle: 'No tokens right now',
    emptyBody: 'Take a token at any salon and it will show here.',
    seeSalons: 'See my salons',
  },
};

type Tone = 'turn' | 'next' | 'wait' | 'unknown';
const TONE: Record<Tone, string> = {
  turn: 'border-green-500 bg-green-50',
  next: 'border-amber-400 bg-amber-50',
  wait: 'border-gray-200 bg-white',
  unknown: 'border-gray-200 bg-white',
};

function TicketCard({ item, salonName }: { item: ActiveTicket; salonName: string }) {
  const t = useT(TEXT);
  const { stored, ticket } = item;
  let tone: Tone = 'unknown';
  let line = t.unknown;
  if (ticket) {
    if (ticket.status === 'CALLED') [tone, line] = ['turn', t.yourTurn];
    else if (ticket.status === 'SERVING') [tone, line] = ['turn', t.serving];
    else if (ticket.peopleAhead === 0) [tone, line] = ['next', t.next];
    else [tone, line] = ['wait', t.ahead(ticket.peopleAhead, ticket.estimatedWaitMinutes)];
  }

  return (
    <li>
      <Link
        to={ticketUrl(stored.ticketId, stored.accessToken)}
        className={`flex items-center gap-4 rounded-2xl border-2 p-4 shadow-sm hover:bg-gray-50 ${TONE[tone]}`}
      >
        <span className="min-w-16 text-center text-4xl font-extrabold tabular-nums text-ink">#{stored.tokenNumber}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-bold text-ink">{salonName}</span>
          <span className={`block text-base ${tone === 'turn' ? 'font-semibold text-green-900' : tone === 'next' ? 'font-semibold text-amber-900' : 'text-gray-700'}`}>
            {line}
          </span>
        </span>
        <Icon name="chevron" className="shrink-0 text-gray-500" />
      </Link>
    </li>
  );
}

export default function MyTickets() {
  const t = useT(TEXT);
  const queryClient = useQueryClient();
  const { tickets, isChecking } = useActiveTickets();

  // The ticket page is live over the socket; this list just re-checks every 30 s.
  useEffect(() => {
    const id = setInterval(() => void queryClient.invalidateQueries({ queryKey: ['ticket'] }), 30_000);
    return () => clearInterval(id);
  }, [queryClient]);

  const names = new Map(getMySalons().map((s) => [s.salonId, s.name]));

  return (
    <PageShell title={t.title}>
      <CustomerHeader title={t.title} />

      {tickets.length > 0 ? (
        <ul className="grid gap-3">
          {tickets.map((item) => (
            <TicketCard key={item.stored.ticketId} item={item} salonName={names.get(item.stored.salonId) ?? t.salon} />
          ))}
        </ul>
      ) : isChecking ? (
        <>
          <div className="h-24 animate-pulse rounded-2xl bg-gray-200" aria-hidden="true" />
          <p role="status" className="mt-4 text-center text-gray-600">{t.checking}</p>
        </>
      ) : (
        <div className="card flex flex-col items-center p-6 text-center">
          <span aria-hidden="true" className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-ink">
            <Icon name="ticket" size={30} />
          </span>
          <p className="text-lg font-semibold">{t.emptyTitle}</p>
          <p className="mt-2 text-base text-gray-700">{t.emptyBody}</p>
          <Link to="/c" className="btn-secondary mt-5">{t.seeSalons}</Link>
        </div>
      )}
    </PageShell>
  );
}
