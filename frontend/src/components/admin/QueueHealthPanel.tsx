// frontend/src/components/admin/QueueHealthPanel.tsx
// Tech → Queues: integrity checks across all salons, today's notification numbers,
// and a read-only look at any salon's queue. Token numbers only — no customer details.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchQueueHealth, fetchReadOnlyQueue, searchTechSalons, type QueueCheck } from '../../api/admin';

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';

function rowText(c: QueueCheck, r: QueueCheck['rows'][number]) {
  switch (c.id) {
    case 'duplicate_tokens': return `${r.salon} · ${r.date} · token #${r.token} given ${r.copies} times`;
    case 'double_serving': return `${r.salon} · ${r.date} · tokens ${(r.tokens ?? []).map((t) => `#${t}`).join(', ')} serving together`;
    case 'overdue_serving': return `${r.salon} · token #${r.token} · ${r.minutes_over} min over`;
    case 'stale_active': return `${r.salon} · ${r.date} · ${r.tickets} open tickets`;
    case 'stuck_paused': return `${r.salon} · paused ${r.minutes_paused} min · ${r.waiting} waiting`;
  }
}

function CheckRow({ c, onOpen }: { c: QueueCheck; onOpen: (salonId: string) => void }) {
  const ok = c.count === 0;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{c.label}</span>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${
          ok ? 'border-green-600 bg-green-50 text-green-900'
          : c.serious ? 'border-red-400 bg-red-50 text-red-900' : 'border-amber-400 bg-amber-50 text-amber-900'
        }`}>
          {ok ? 'OK' : `${c.count}${c.count === 50 ? '+' : ''} found`}
        </span>
      </div>
      {!ok && (
        <ul className="mt-1 grid gap-1">
          {c.rows.map((r, i) => (
            <li key={`${r.salon_id}-${i}`}>
              <button type="button" className="text-left text-sm underline" onClick={() => onOpen(r.salon_id)}>
                {rowText(c, r)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ReadOnlyQueueView({ salonId, onClose }: { salonId: string; onClose: () => void }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['techQueue', salonId],
    queryFn: () => fetchReadOnlyQueue(salonId),
    retry: false,
  });
  return (
    <section aria-label="Salon queue" className="card grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-sm font-semibold text-gray-700 underline" onClick={onClose}>‹ Back</button>
        <button type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={isFetching} onClick={() => refetch()}>
          {isFetching ? 'Loading...' : 'Reload'}
        </button>
      </div>
      {isLoading && <p role="status" className="text-gray-600">Loading queue...</p>}
      {isError && <p role="alert" className="text-red-700">Couldn't load this queue.</p>}
      {data && (
        <>
          <h3 className="text-lg font-bold">{data.salon.name}</h3>
          <p className="text-sm text-gray-700">
            {data.salon.isSuspended ? 'Suspended · ' : ''}
            {data.salon.isOpen ? 'Open' : 'Closed'} ({data.salon.hours}) · queue switched {data.salon.isQueueActive ? 'on' : 'off'}
            {data.queue ? ` · today's queue ${data.queue.status.toLowerCase()} · next token #${data.queue.nextToken}` : ' · no queue today yet'}
          </p>
          <p className="text-xs text-gray-600">Read-only. Nothing here changes the queue.</p>
          {data.entries.length === 0 ? (
            <p className="text-gray-600">No tickets today.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Today's tickets for {data.salon.name}</caption>
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th scope="col" className="px-2 py-1">Token</th>
                    <th scope="col" className="px-2 py-1">Status</th>
                    <th scope="col" className="px-2 py-1">Line</th>
                    <th scope="col" className="px-2 py-1">Joined</th>
                    <th scope="col" className="px-2 py-1">Started</th>
                    <th scope="col" className="px-2 py-1">Ends</th>
                    <th scope="col" className="px-2 py-1">Notices</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 tabular-nums">
                  {data.entries.map((e) => (
                    <tr key={e.token}>
                      <th scope="row" className="px-2 py-1">
                        #{e.token}{e.walkIn ? ' (walk-in)' : ''}{e.priority ? ' (moved up)' : ''}
                      </th>
                      <td className="px-2 py-1">{e.status.toLowerCase()}</td>
                      <td className="px-2 py-1">{e.line ?? '—'}</td>
                      <td className="px-2 py-1">{fmtTime(e.joinedAt)}</td>
                      <td className="px-2 py-1">{fmtTime(e.startedAt)}</td>
                      <td className="px-2 py-1">{fmtTime(e.endsAt)}</td>
                      <td className="px-2 py-1">{e.notifiedStage}/3</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SalonPicker({ onOpen }: { onOpen: (id: string) => void }) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState<string | null>(null);
  const { data, isFetching, isError } = useQuery({
    queryKey: ['techSalons', search],
    queryFn: () => searchTechSalons(search ?? ''),
    enabled: search !== null,
    retry: false,
  });
  return (
    <section aria-label="Look at a salon's queue" className="card grid gap-2">
      <h3 className="text-base font-semibold">Look at a salon's queue</h3>
      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(draft.trim()); }}>
        <label htmlFor="tech-salon-search" className="sr-only">Salon name or address</label>
        <input id="tech-salon-search" type="search" className="field flex-1" placeholder="Salon name or address"
          value={draft} maxLength={50} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn-secondary min-h-12 px-4">Find</button>
      </form>
      {isFetching && <p role="status" className="text-sm text-gray-600">Searching...</p>}
      {isError && <p role="alert" className="text-sm text-red-700">Search failed.</p>}
      {data && data.length === 0 && <p className="text-sm text-gray-600">No salons found.</p>}
      {data && data.length > 0 && (
        <ul aria-label="Matching salons" className="divide-y divide-gray-200">
          {data.map((s) => (
            <li key={s.id}>
              <button type="button" className="min-h-11 w-full py-2 text-left" onClick={() => onOpen(s.id)}>
                <span className="font-medium">{s.name}</span>
                {s.isInternal && <span className="ml-2 text-xs text-gray-600">(internal)</span>}
                {s.isSuspended && <span className="ml-2 text-xs font-bold text-red-800">(suspended)</span>}
                <span className="block text-xs text-gray-600">{s.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function QueueHealthPanel() {
  const [openSalon, setOpenSalon] = useState<string | null>(null);
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['techQueueHealth'],
    queryFn: fetchQueueHealth,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (openSalon) return <ReadOnlyQueueView salonId={openSalon} onClose={() => setOpenSalon(null)} />;

  const p = data?.pushToday;
  const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100));

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-end">
        <button type="button" onClick={() => refetch()} disabled={isFetching} aria-busy={isFetching}
          className="btn-secondary min-h-11 px-4 text-sm">
          {isFetching ? 'Checking...' : 'Run checks'}
        </button>
      </div>

      {isLoading && <p role="status" className="text-gray-600">Running queue checks...</p>}
      {isError && !data && (
        <div className="card text-center">
          <p role="alert" className="mb-3 text-red-700">Couldn't run the checks.</p>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      )}

      {data && (
        <>
          <section aria-label="Queue checks" className="card">
            <h3 className="mb-1 text-base font-semibold">Queue checks (all salons)</h3>
            <ul className="divide-y divide-gray-200">
              {data.checks.map((c) => <CheckRow key={c.id} c={c} onOpen={setOpenSalon} />)}
            </ul>
          </section>

          {p && (
            <section aria-label="Notifications today" className="card">
              <h3 className="mb-1 text-base font-semibold">Notifications today</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-gray-600">QR tickets</dt><dd>{p.qrTickets}</dd>
                <dt className="text-gray-600">Turned notifications on</dt><dd>{p.withPush} ({pct(p.withPush, p.qrTickets)}%)</dd>
                <dt className="text-gray-600">Got "getting close"</dt><dd>{p.gotClose}</dd>
                <dt className="text-gray-600">Got "you're next"</dt><dd>{p.gotNext}</dd>
                <dt className="text-gray-600">Got "your turn"</dt><dd>{p.gotTurn}</dd>
              </dl>
              {(() => {
                const d = data.pushDelivery;
                const tried = d.today.sent + d.today.expired + d.today.failed;
                const week = d.total.sent + d.total.expired + d.total.failed;
                return (
                  <>
                    <h4 className="mt-3 text-sm font-semibold">Delivery to the push service</h4>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <dt className="text-gray-600">Today: sent</dt><dd>{d.today.sent} ({pct(d.today.sent, tried)}%)</dd>
                      <dt className="text-gray-600">Today: expired</dt><dd>{d.today.expired}</dd>
                      <dt className="text-gray-600">Today: failed</dt>
                      <dd>{d.today.failed}{d.today.lastFailureCode ? ` (last: ${d.today.lastFailureCode})` : ''}</dd>
                      <dt className="text-gray-600">Last 7 days: sent</dt><dd>{d.total.sent} of {week} ({pct(d.total.sent, week)}%)</dd>
                    </dl>
                    <p className="mt-2 text-xs text-gray-600">
                      "Sent" means Google/Apple accepted it for delivery. "Expired" means the customer's phone turned notifications off
                      or reset the browser. Whether the phone actually showed it can't be known.
                    </p>
                  </>
                );
              })()}
            </section>
          )}
        </>
      )}

      <SalonPicker onOpen={setOpenSalon} />
    </div>
  );
}
