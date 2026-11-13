// frontend/src/pages/MySalons.tsx
// Customer app home (/c): every salon this phone has scanned, with its live line. No search, no discovery:
// a salon appears here only after its wall QR was scanned on this phone.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import { fetchPublicQueue } from '../api/salons';
import { getTickets } from '../lib/activeTickets';
import { getMySalons, removeMySalon, type MySalon } from '../lib/mySalons';

const ticketUrl = (ticketId: string, accessToken: string) => `/tickets/${ticketId}?accessToken=${accessToken}`;

// The socket allows only a few rooms per phone, so the list polls; the salon page itself is live.
function SalonCard({ salon, onRemove }: { salon: MySalon; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const { data: q, isError } = useQuery({
    queryKey: ['publicQueue', salon.salonId],
    queryFn: () => fetchPublicQueue(salon.salonId),
    refetchInterval: 30_000,
    retry: false,
  });
  const mine = getTickets(salon.salonId)[0] ?? null;

  const line = isError
    ? 'अभी उपलब्ध नहीं'
    : !q
      ? 'देख रहे हैं...'
      : !q.isOpen
        ? '🔒 अभी बंद है'
        : q.isPaused
          ? '⏸ लाइन रुकी हुई है'
          : `अभी #${q.nowServingToken} · ${q.waitingCount} लोग इंतज़ार में`;

  return (
    <li className="card p-0">
      <Link to={`/c/s/${salon.code}`} className="block px-4 py-4 hover:bg-brand-soft">
        <span className="block text-lg font-bold text-ink">{q?.name ?? salon.name}</span>
        <span className="mt-1 block text-base text-gray-700">{line}</span>
      </Link>
      <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-2">
        {mine ? (
          <Link to={ticketUrl(mine.ticketId, mine.accessToken)} className="text-base font-semibold text-ink underline">
            आपका टोकन #{mine.tokenNumber}
          </Link>
        ) : (
          <span />
        )}
        {!confirming ? (
          <button type="button" className="min-h-11 px-2 text-sm text-gray-600" onClick={() => setConfirming(true)}>
            हटाएँ
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <button type="button" className="min-h-11 px-2 text-sm font-semibold text-red-700" onClick={onRemove}>
              हाँ, हटाएँ
            </button>
            <button type="button" className="min-h-11 px-2 text-sm text-gray-600" onClick={() => setConfirming(false)}>
              रहने दें
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

export default function MySalons() {
  const [salons, setSalons] = useState<MySalon[]>(() => getMySalons());

  return (
    <PageShell title="मेरे सैलून">
      <h1 className="mb-1 text-2xl font-bold">मेरे सैलून</h1>
      <p className="mb-5 text-base text-gray-700">लाइन देखें और घर बैठे टोकन लें।</p>

      {salons.length === 0 ? (
        <div className="card p-6 text-center">
          <span aria-hidden="true" className="mb-2 block text-4xl">📷</span>
          <p className="text-lg font-semibold">अभी कोई सैलून नहीं</p>
          <p className="mt-2 text-base text-gray-700">
            किसी सैलून में लगा QR कोड स्कैन करें। वह सैलून यहाँ अपने-आप जुड़ जाएगा।
          </p>
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
