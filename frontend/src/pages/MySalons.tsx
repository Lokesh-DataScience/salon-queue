// frontend/src/pages/MySalons.tsx
// Customer app home (/c): every salon this phone has scanned, with its live line. No search, no discovery:
// a salon appears here only after its wall QR was scanned on this phone.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import Icon from '../components/Icon';
import SalonStatus, { salonState } from '../components/SalonStatus';
import { fetchPublicQueue } from '../api/salons';
import { getTickets } from '../lib/activeTickets';
import { getMySalons, removeMySalon, type MySalon } from '../lib/mySalons';
import { useT } from '../lib/i18n';

const ticketUrl = (ticketId: string, accessToken: string) => `/tickets/${ticketId}?accessToken=${accessToken}`;

const TEXT = {
  hi: {
    title: 'मेरे सैलून',
    subtitle: 'लाइन देखें और घर बैठे टोकन लें।',
    unavailable: 'अभी उपलब्ध नहीं',
    checking: 'देख रहे हैं...',
    line: (now: number, waiting: number) => `अभी #${now} · ${waiting} लोग इंतज़ार में`,
    myToken: (n: number) => `आपका टोकन #${n}`,
    remove: 'हटाएँ',
    removeYes: 'हाँ, हटाएँ',
    removeNo: 'रहने दें',
    removeAsk: 'सूची से हटाएँ?',
    emptyTitle: 'अभी कोई सैलून नहीं',
    emptyBody: 'किसी सैलून में लगा QR कोड स्कैन करें। वह सैलून यहाँ अपने-आप जुड़ जाएगा।',
  },
  en: {
    title: 'My salons',
    subtitle: 'See the queue and take a token from home.',
    unavailable: 'Not available right now',
    checking: 'Checking...',
    line: (now: number, waiting: number) => `Now #${now} · ${waiting} waiting`,
    myToken: (n: number) => `Your token #${n}`,
    remove: 'Remove',
    removeYes: 'Yes, remove',
    removeNo: 'Keep',
    removeAsk: 'Remove from list?',
    emptyTitle: 'No salons yet',
    emptyBody: "Scan the QR code at any salon. It will appear here automatically.",
  },
};

// The socket allows only a few rooms per phone, so the list polls; the salon page itself is live.
function SalonCard({ salon, onRemove }: { salon: MySalon; onRemove: () => void }) {
  const t = useT(TEXT);
  const [confirming, setConfirming] = useState(false);
  const { data: q, isError } = useQuery({
    queryKey: ['publicQueue', salon.salonId],
    queryFn: () => fetchPublicQueue(salon.salonId),
    refetchInterval: 30_000,
    retry: false,
  });
  const mine = getTickets(salon.salonId)[0] ?? null;
  const state = q ? salonState(q) : null;

  return (
    <li className="card overflow-hidden p-0">
      <Link to={`/c/s/${salon.code}`} className="flex items-center gap-3 px-4 py-4 hover:bg-gray-50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-bold text-ink">{q?.name ?? salon.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-base">
            {isError ? (
              <span className="text-gray-600">{t.unavailable}</span>
            ) : !q || !state ? (
              <span className="text-gray-600">{t.checking}</span>
            ) : (
              <>
                <SalonStatus state={state} />
                {state === 'open' && <span className="text-gray-700">· {t.line(q.nowServingToken, q.waitingCount)}</span>}
              </>
            )}
          </span>
        </span>
        <Icon name="chevron" className="shrink-0 text-gray-500" />
      </Link>

      <div className="flex min-h-12 items-center justify-between gap-3 border-t border-gray-200 px-4 py-1">
        {mine ? (
          <Link
            to={ticketUrl(mine.ticketId, mine.accessToken)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-soft px-3 text-base font-semibold text-ink"
          >
            <Icon name="ticket" size={18} />
            {t.myToken(mine.tokenNumber)}
          </Link>
        ) : (
          <span />
        )}
        {!confirming ? (
          <button type="button" className="min-h-11 px-2 text-sm text-gray-600" onClick={() => setConfirming(true)}>
            {t.remove}
          </button>
        ) : (
          <span className="flex items-center gap-1" role="group" aria-label={t.removeAsk}>
            <button type="button" className="min-h-11 px-2 text-sm font-semibold text-red-700" onClick={onRemove}>
              {t.removeYes}
            </button>
            <button type="button" className="min-h-11 px-2 text-sm text-gray-600" onClick={() => setConfirming(false)}>
              {t.removeNo}
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

export default function MySalons() {
  const t = useT(TEXT);
  const [salons, setSalons] = useState<MySalon[]>(() => getMySalons());

  return (
    <PageShell title={t.title}>
      <CustomerHeader title={t.title} subtitle={t.subtitle} />

      {salons.length === 0 ? (
        <div className="card flex flex-col items-center p-6 text-center">
          <span aria-hidden="true" className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-ink">
            <Icon name="camera" size={30} />
          </span>
          <p className="text-lg font-semibold">{t.emptyTitle}</p>
          <p className="mt-2 text-base text-gray-700">{t.emptyBody}</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {salons.map((s) => (
            <SalonCard
              key={s.salonId}
              salon={s}
              onRemove={() => {
                removeMySalon(s.salonId);
                setSalons(getMySalons());
              }}
            />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
