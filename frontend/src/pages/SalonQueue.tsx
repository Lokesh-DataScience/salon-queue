// frontend/src/pages/SalonQueue.tsx
// Customer app: one salon's live queue (/c/s/:code). Counts and token numbers only, never other customers.
// "Join" hands over to the normal scan flow (/c/s/:code/join), so details, services, barber choice and
// "you already have a ticket" all work exactly as at the wall QR.
import { useEffect, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import { ApiError } from '../api/client';
import { fetchPublicQueue, fetchSalonByCode } from '../api/salons';
import { socket } from '../lib/socket';
import { getTickets } from '../lib/activeTickets';
import { saveMySalon } from '../lib/mySalons';

const ticketUrl = (ticketId: string, accessToken: string) => `/tickets/${ticketId}?accessToken=${accessToken}`;

function Notice({ tone, children }: { tone: 'amber' | 'red'; children: ReactNode }) {
  const cls = tone === 'red' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900';
  return (
    <p role="status" className={`mt-4 rounded-xl border p-3 text-base ${cls}`}>
      {children}
    </p>
  );
}

export default function SalonQueue() {
  const { code = '' } = useParams<{ code: string }>();
  const queryClient = useQueryClient();

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

  const back = (
    <Link to="/c" className="mb-3 inline-block text-base font-semibold text-ink underline">
      ← मेरे सैलून
    </Link>
  );

  if (salonQ.isLoading || (salonId && queueQ.isLoading)) {
    return (
      <PageShell title="सैलून की लाइन">
        {back}
        <div className="animate-pulse space-y-4" aria-hidden="true">
          <div className="h-32 rounded-2xl bg-gray-200" />
          <div className="h-16 rounded-2xl bg-gray-200" />
        </div>
        <p role="status" className="mt-4 text-center text-gray-600">लाइन देख रहे हैं...</p>
      </PageShell>
    );
  }

  const err = salonQ.error ?? queueQ.error;
  if (err || !salonQ.data || !queueQ.data) {
    const status = err instanceof ApiError ? err.status : 0;
    const message =
      status === 404
        ? 'यह QR कोड पहचाना नहीं गया। कृपया सैलून में लगा QR कोड फिर से स्कैन करें।'
        : status === 409
          ? 'यह सैलून अभी टोकन नहीं ले रहा है।'
          : 'सर्वर से जुड़ नहीं पाए। इंटरनेट चालू करके फिर से कोशिश करें।';
    return (
      <PageShell title="सैलून की लाइन">
        {back}
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-base text-red-900">
          {message}
        </p>
        {status !== 404 && status !== 409 && (
          <button type="button" className="btn-primary mt-6" onClick={() => void salonQ.refetch().then(() => queueQ.refetch())}>
            फिर से कोशिश करें
          </button>
        )}
      </PageShell>
    );
  }

  const q = queueQ.data;
  const mine = getTickets(q.salonId)[0] ?? null; // this phone already holds a ticket here
  const blocked = !q.isOpen
    ? 'सैलून अभी बंद है।'
    : q.isPaused
      ? 'सैलून ने लाइन अभी रोकी हुई है। थोड़ी देर बाद देखें।'
      : !q.allowAppJoin
        ? 'इस सैलून में ऐप से टोकन बंद है। सैलून में लगा QR कोड स्कैन करें।'
        : null;

  return (
    <PageShell title={q.name}>
      {back}
      <section aria-label="सैलून" className="rounded-3xl border-2 border-ink bg-brand p-5 text-ink shadow-[0_6px_0_0_var(--color-ink)]">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-extrabold">{q.name}</h1>
          <span className="pill shrink-0 border-ink bg-white text-sm font-semibold">
            {!q.isOpen ? '🔒 बंद' : q.isPaused ? '⏸ रुका हुआ' : '🟢 खुला'}
          </span>
        </div>
        <p className="mt-4 text-sm font-bold uppercase tracking-wide">अभी चल रहा है</p>
        <p className="text-6xl font-extrabold tabular-nums">#{q.nowServingToken}</p>
      </section>

      <section aria-label="लाइन" className="card mt-4 divide-y divide-gray-200 p-0">
        <p className="px-4 py-3 text-lg font-semibold">
          {q.waitingCount === 0 ? 'कोई इंतज़ार में नहीं' : `${q.waitingCount} लोग इंतज़ार में`}
        </p>
        {q.estimatedWaitMinutes != null && (
          <p className="px-4 py-3 text-base text-gray-700">अनुमानित इंतज़ार: ~{q.estimatedWaitMinutes} मिनट</p>
        )}
      </section>

      {q.lanes && (
        <section aria-label="बार्बर" className="card mt-4 p-0">
          <ul className="divide-y divide-gray-200">
            {q.lanes.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="font-semibold">{l.name}</span>
                <span className="text-sm text-gray-700">
                  {l.isPaused ? 'ब्रेक पर' : `${l.waitingCount} इंतज़ार में · ~${l.estimatedWaitMinutes} मिनट`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6">
        {mine ? (
          <Link to={ticketUrl(mine.ticketId, mine.accessToken)} className="btn-primary">
            मेरा टोकन देखें #{mine.tokenNumber}
          </Link>
        ) : blocked ? (
          <>
            <button type="button" className="btn-primary" disabled>
              घर बैठे टोकन लें
            </button>
            <Notice tone="amber">{blocked}</Notice>
          </>
        ) : (
          <Link to={`/c/s/${code}/join`} className="btn-primary">
            घर बैठे टोकन लें
          </Link>
        )}
      </div>
      <p className="mt-4 text-center text-sm text-gray-600">यह पेज अपने-आप अपडेट होता है।</p>
    </PageShell>
  );
}
