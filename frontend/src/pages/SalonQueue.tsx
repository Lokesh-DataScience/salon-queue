// frontend/src/pages/SalonQueue.tsx
// Customer app: one salon's live queue (/c/s/:code). Counts and token numbers only, never other customers.
// Also the salon's own info (hours, address/map, call) and its services with prices.
// "Join" hands over to the normal scan flow (/c/s/:code/join), so details, services, barber choice and
// "you already have a ticket" all work exactly as at the wall QR.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import Icon from '../components/Icon';
import SalonStatus, { salonState } from '../components/SalonStatus';
import { ApiError } from '../api/client';
import { fetchPublicQueue, fetchSalonByCode, type PublicQueue } from '../api/salons';
import { fetchSalonServices } from '../api/publicServices';
import { socket } from '../lib/socket';
import { getTickets } from '../lib/activeTickets';
import { isSalonPinned, saveMySalon, setSalonPinned } from '../lib/mySalons';
import { useLang, useT } from '../lib/i18n';
import { callHref, formatDays, formatHours, formatRupees, mapsHref } from '../lib/salonInfo';

const ticketUrl = (ticketId: string, accessToken: string) => `/tickets/${ticketId}?accessToken=${accessToken}`;

const TEXT = {
  hi: {
    pageTitle: 'सैलून की लाइन',
    back: 'मेरे सैलून पर वापस',
    loading: 'लाइन देख रहे हैं...',
    notFound: 'यह QR कोड पहचाना नहीं गया। कृपया सैलून में लगा QR कोड फिर से स्कैन करें।',
    notTaking: 'यह सैलून अभी टोकन नहीं ले रहा है।',
    noServer: 'सर्वर से जुड़ नहीं पाए। इंटरनेट चालू करके फिर से कोशिश करें।',
    retry: 'फिर से कोशिश करें',
    info: 'सैलून की जानकारी',
    rating: (a: string, n: number) => `${a} · ${n} रेटिंग`,
    ratingLabel: (a: string, n: number) => `${n} ग्राहकों की औसत रेटिंग: 5 में से ${a}`,
    hours: (h: string) => `रोज़ ${h}`,
    hoursNotDaily: (h: string) => `समय ${h}`,
    weeklyOff: (d: string) => `साप्ताहिक छुट्टी: ${d}`,
    offToday: (d: string | null) =>
      d ? `आज साप्ताहिक छुट्टी है (हर ${d})। किसी और दिन टोकन लें।` : 'आज साप्ताहिक छुट्टी है। किसी और दिन टोकन लें।',
    map: 'नक्शा',
    call: 'कॉल करें',
    pin: 'ऊपर पिन करें',
    unpin: 'पिन हटाएँ',
    nowServing: 'अभी चल रहा',
    waiting: 'इंतज़ार में',
    waitMin: 'मिनट इंतज़ार',
    nobodyWaiting: 'कोई इंतज़ार में नहीं — अभी आएँ!',
    barbers: 'बार्बर',
    onBreak: 'ब्रेक पर',
    laneLine: (w: number, m: number) => `${w} इंतज़ार में · ~${m} मिनट`,
    myToken: (n: number) => `मेरा टोकन देखें #${n}`,
    join: 'घर बैठे टोकन लें',
    closed: 'सैलून अभी बंद है।',
    paused: 'सैलून ने लाइन अभी रोकी हुई है। थोड़ी देर बाद देखें।',
    appOff: 'इस सैलून में ऐप से टोकन बंद है। सैलून में लगा QR कोड स्कैन करें।',
    services: 'सेवाएँ और रेट',
    min: (m: number) => `${m} मिनट`,
    priceNote: 'रेट सैलून ने बताए हैं। पक्का रेट सैलून में पूछें।',
    live: 'यह पेज अपने-आप अपडेट होता है।',
  },
  en: {
    pageTitle: 'Salon queue',
    back: 'Back to my salons',
    loading: 'Checking the queue...',
    notFound: "This QR code wasn't recognised. Please scan the QR code at the salon again.",
    notTaking: "This salon isn't taking tokens right now.",
    noServer: "Couldn't reach the server. Turn on your internet and try again.",
    retry: 'Try again',
    info: 'Salon details',
    rating: (a: string, n: number) => `${a} · ${n} ratings`,
    ratingLabel: (a: string, n: number) => `Average rating from ${n} customers: ${a} out of 5`,
    hours: (h: string) => `Daily ${h}`,
    hoursNotDaily: (h: string) => `Open ${h}`,
    weeklyOff: (d: string) => `Weekly off: ${d}`,
    offToday: (d: string | null) =>
      d ? `Today is the weekly off (every ${d}). Take a token on another day.` : 'Today is the weekly off. Take a token on another day.',
    map: 'Map',
    call: 'Call',
    pin: 'Pin to top',
    unpin: 'Unpin',
    nowServing: 'Now serving',
    waiting: 'Waiting',
    waitMin: 'min wait',
    nobodyWaiting: 'Nobody waiting — come now!',
    barbers: 'Barbers',
    onBreak: 'On a break',
    laneLine: (w: number, m: number) => `${w} waiting · ~${m} min`,
    myToken: (n: number) => `See my token #${n}`,
    join: 'Take a token from home',
    closed: 'The salon is closed now.',
    paused: 'The salon has paused the queue. Check again in a little while.',
    appOff: 'This salon has turned off tokens from the app. Scan the QR code at the salon.',
    services: 'Services & prices',
    min: (m: number) => `${m} min`,
    priceNote: 'Prices are set by the salon. Please confirm at the salon.',
    live: 'This page updates by itself.',
  },
};

function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
      {children}
    </p>
  );
}

// A screen reader hears "Waiting, group: 3" — the label names the tile, the number is its content.
function Stat({ value, label }: { value: string; label: string }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="card flex flex-col items-center px-2 py-3 text-center">
      <span className="text-2xl font-extrabold tabular-nums text-ink">{value}</span>
      <span id={id} className="text-sm text-gray-600">{label}</span>
    </div>
  );
}

function PinButton({ salonId }: { salonId: string }) {
  const t = useT(TEXT);
  const [pinned, setPinned] = useState(() => isSalonPinned(salonId));
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={pinned ? t.unpin : t.pin}
      title={pinned ? t.unpin : t.pin}
      onClick={() => {
        setSalonPinned(salonId, !pinned);
        setPinned(!pinned);
      }}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-gray-100 ${
        pinned ? 'text-ink' : 'text-gray-600'
      }`}
    >
      <Icon name="pin" filled={pinned} />
    </button>
  );
}

function InfoCard({ q }: { q: PublicQueue }) {
  const t = useT(TEXT);
  const lang = useLang();
  const hours = formatHours(q.openingTime, q.closingTime, lang);
  const offDays = formatDays(q.weeklyOffDays, lang); // null = open every day
  const map = mapsHref(q);
  const call = callHref(q.phone);
  const action =
    'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-ink bg-white px-3 text-base font-semibold text-ink hover:bg-brand-soft';

  return (
    <section aria-label={t.info} className="card grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <SalonStatus state={salonState(q)} className="text-lg" />
        {hours && (
          <span className="inline-flex items-center gap-1.5 text-base text-gray-700">
            <Icon name="clock" size={18} />
            {offDays ? t.hoursNotDaily(hours) : t.hours(hours)}
          </span>
        )}
      </div>
      {offDays && <p className="text-base text-gray-700">{t.weeklyOff(offDays)}</p>}
      {q.rating && (
        <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
          <span aria-hidden="true" className="text-lg text-brand-dark">★</span>
          <span aria-hidden="true">{t.rating(q.rating.average.toFixed(1), q.rating.count)}</span>
          <span className="sr-only">{t.ratingLabel(q.rating.average.toFixed(1), q.rating.count)}</span>
        </p>
      )}
      {q.address && (
        <p className="flex items-start gap-1.5 text-base text-gray-700">
          <Icon name="mapPin" size={18} className="mt-0.5 shrink-0" />
          <span className="break-words">{q.address}</span>
        </p>
      )}
      {(map || call) && (
        <div className="mt-1 flex gap-2">
          {map && (
            <a href={map} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={action}>
              <Icon name="mapPin" size={18} />
              {t.map}
            </a>
          )}
          {call && (
            <a href={call} className={action}>
              <Icon name="phone" size={18} />
              {t.call}
            </a>
          )}
        </div>
      )}
    </section>
  );
}

// Read-only list. Hidden when the salon has no services (or the list can't be loaded).
function ServicesCard({ salonId }: { salonId: string }) {
  const t = useT(TEXT);
  const { data: services } = useQuery({
    queryKey: ['salonServices', salonId],
    queryFn: () => fetchSalonServices(salonId),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!services || services.length === 0) return null;
  const anyPrice = services.some((s) => s.priceRupees != null);

  return (
    <section aria-labelledby="services-title" className="card mt-4 p-0">
      <h2 id="services-title" className="px-4 pt-3 text-base font-bold text-ink">{t.services}</h2>
      <ul className="divide-y divide-gray-200">
        {services.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block break-words font-semibold">{s.name}</span>
              <span className="text-sm text-gray-600">{t.min(s.durationMinutes)}</span>
            </span>
            {s.priceRupees != null && (
              <span className="shrink-0 text-base font-bold tabular-nums text-ink">{formatRupees(s.priceRupees)}</span>
            )}
          </li>
        ))}
      </ul>
      {anyPrice && <p className="px-4 pb-3 text-sm text-gray-600">{t.priceNote}</p>}
    </section>
  );
}

export default function SalonQueue() {
  const { code = '' } = useParams<{ code: string }>();
  const queryClient = useQueryClient();
  const t = useT(TEXT);
  const lang = useLang();

  const salonQ = useQuery({ queryKey: ['salonByCode', code], queryFn: () => fetchSalonByCode(code), retry: false });
  const salonId = salonQ.data?.id;

  const queueQ = useQuery({
    queryKey: ['publicQueue', salonId],
    queryFn: () => fetchPublicQueue(salonId!),
    enabled: !!salonId,
    refetchInterval: 60_000, // safety net; live updates come over the socket
  });

  // Keep the saved name fresh (the barber may rename the salon).
  useEffect(() => {
    if (salonQ.data) saveMySalon({ salonId: salonQ.data.id, code, name: salonQ.data.name });
  }, [salonQ.data, code]);

  // Live: the salon's room tells us when anything changes; we re-read the public view.
  useEffect(() => {
    if (!salonId) return;
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['publicQueue', salonId] });
    function joinRoom() {
      socket.emit('join:salon', { salonId });
      refresh(); // catch up after a reconnect
    }
    joinRoom();
    socket.on('connect', joinRoom);
    socket.on('queue:updated', refresh);
    return () => {
      socket.off('connect', joinRoom);
      socket.off('queue:updated', refresh);
      socket.emit('leave:salon', { salonId });
    };
  }, [salonId, queryClient]);

  if (salonQ.isLoading || (salonId && queueQ.isLoading)) {
    return (
      <PageShell title={t.pageTitle}>
        {/* The salon's name becomes the heading only once its queue has loaded. */}
        <CustomerHeader title={t.pageTitle} backTo="/c" backLabel={t.back} />
        <div className="animate-pulse space-y-3" aria-hidden="true">
          <div className="h-24 rounded-2xl bg-gray-200" />
          <div className="grid grid-cols-3 gap-2">
            <div className="h-20 rounded-2xl bg-gray-200" />
            <div className="h-20 rounded-2xl bg-gray-200" />
            <div className="h-20 rounded-2xl bg-gray-200" />
          </div>
          <div className="h-12 rounded-xl bg-gray-200" />
        </div>
        <p role="status" className="mt-4 text-center text-gray-600">{t.loading}</p>
      </PageShell>
    );
  }

  const err = salonQ.error ?? queueQ.error;
  if (err || !salonQ.data || !queueQ.data) {
    const status = err instanceof ApiError ? err.status : 0;
    const message = status === 404 ? t.notFound : status === 409 ? t.notTaking : t.noServer;
    return (
      <PageShell title={t.pageTitle}>
        <CustomerHeader title={t.pageTitle} backTo="/c" backLabel={t.back} />
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-base text-red-900">
          {message}
        </p>
        {status !== 404 && status !== 409 && (
          <button type="button" className="btn-primary mt-6" onClick={() => void salonQ.refetch().then(() => queueQ.refetch())}>
            {t.retry}
          </button>
        )}
      </PageShell>
    );
  }

  const q = queueQ.data;
  const state = salonState(q);
  const mine = getTickets(q.salonId)[0] ?? null; // this phone already holds a ticket here
  const blocked =
    state === 'offday'
      ? t.offToday(formatDays(q.weeklyOffDays, lang))
      : state === 'closed'
        ? t.closed
        : state === 'paused' ? t.paused : !q.allowAppJoin ? t.appOff : null;

  return (
    <PageShell title={q.name}>
      <CustomerHeader title={q.name} backTo="/c" backLabel={t.back} action={<PinButton salonId={q.salonId} />} />

      <InfoCard q={q} />

      <section aria-label={t.pageTitle} className="mt-3 grid grid-cols-3 gap-2">
        <Stat value={`#${q.nowServingToken}`} label={t.nowServing} />
        <Stat value={String(q.waitingCount)} label={t.waiting} />
        <Stat value={q.estimatedWaitMinutes != null ? `~${q.estimatedWaitMinutes}` : '—'} label={t.waitMin} />
      </section>
      {state === 'open' && q.waitingCount === 0 && (
        <p className="mt-2 text-center text-base font-semibold text-green-800">{t.nobodyWaiting}</p>
      )}

      {q.lanes && (
        <section aria-label={t.barbers} className="card mt-3 p-0">
          <h2 className="px-4 pt-3 text-base font-bold text-ink">{t.barbers}</h2>
          <ul className="divide-y divide-gray-200">
            {q.lanes.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="font-semibold">{l.name}</span>
                <span className="text-sm text-gray-700">
                  {l.isPaused ? t.onBreak : t.laneLine(l.waitingCount, l.estimatedWaitMinutes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-5">
        {mine ? (
          <Link to={ticketUrl(mine.ticketId, mine.accessToken)} className="btn-primary gap-2">
            <Icon name="ticket" />
            {t.myToken(mine.tokenNumber)}
          </Link>
        ) : blocked ? (
          <>
            <button type="button" className="btn-primary" disabled>
              {t.join}
            </button>
            <Notice>{blocked}</Notice>
          </>
        ) : (
          <Link to={`/c/s/${code}/join`} className="btn-primary">
            {t.join}
          </Link>
        )}
      </div>

      <ServicesCard salonId={q.salonId} />

      <p className="mt-4 text-center text-sm text-gray-600">{t.live}</p>
    </PageShell>
  );
}
