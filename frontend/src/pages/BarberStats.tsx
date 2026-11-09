// frontend/src/pages/BarberStats.tsx
import { useEffect, useState } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBarberStats, type BarberMe, type BarberStats, type StatsDay } from '../api/barber';
import { socket } from '../lib/socket';
import { ApiError } from '../api/client';

type Period = 'today' | 'week' | 'month';

const LIVE_DEBOUNCE_MS = 2000;
const BACKUP_REFRESH_MS = 60_000;

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

// Dates arrive as IST calendar days (YYYY-MM-DD). Build them from parts so the
// phone's own timezone can never shift the day.
function parseYmd(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const fmtWeekday = (ymd: string) => parseYmd(ymd).toLocaleDateString('en-IN', { weekday: 'short' });
const fmtShort = (ymd: string) => parseYmd(ymd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtFull = (ymd: string) =>
  parseYmd(ymd).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const customers = (n: number) => `${n} ${n === 1 ? 'customer' : 'customers'}`;

function viewFor(stats: BarberStats, period: Period) {
  if (period === 'today') {
    return {
      total: stats.servedToday,
      qr: stats.qrToday,
      walkIn: stats.walkInToday,
      prev: stats.servedYesterday,
      noun: 'today',
      vs: 'yesterday',
      days: null as StatsDay[] | null,
    };
  }
  const p = period === 'week' ? stats.week : stats.month;
  return {
    total: p.total,
    qr: p.qr,
    walkIn: p.walkIn,
    prev: p.prevSamePeriod,
    noun: period === 'week' ? 'this week' : 'this month',
    vs: period === 'week' ? 'the same days last week' : 'the same days last month',
    days: p.days,
  };
}

// Words and a symbol, never colour alone.
function deltaOf(total: number, prev: number, vs: string) {
  const d = total - prev;
  if (d === 0) return { symbol: '=', text: `Same as ${vs}`, tone: 'text-gray-700' };
  if (d > 0) return { symbol: '▲', text: `${d} more than ${vs}`, tone: 'text-green-800' };
  return { symbol: '▼', text: `${Math.abs(d)} fewer than ${vs}`, tone: 'text-gray-700' };
}

function DayBars({
  days,
  today,
  showCounts,
  label,
}: {
  days: StatsDay[];
  today: string;
  showCounts: boolean;
  label: string;
}) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <>
      <ul role="list" aria-label={label} className={`flex items-end ${showCounts ? 'gap-2' : 'gap-0.5'}`}>
        {days.map((d) => {
          const future = d.date > today;
          const isToday = d.date === today;
          const pct = d.count > 0 ? Math.max(6, Math.round((d.count / max) * 100)) : 0;
          const fill = future ? 'bg-gray-200' : isToday ? 'bg-brand border-2 border-ink' : 'bg-ink';
          return (
            <li key={d.date} aria-current={isToday ? 'date' : undefined} className="flex min-w-0 flex-1 flex-col items-center">
              {showCounts && (
                <span aria-hidden="true" className="mb-1 h-4 text-xs font-bold tabular-nums text-ink">
                  {future ? '' : d.count}
                </span>
              )}
              <div aria-hidden="true" className="flex h-32 w-full items-end">
                <div className={`w-full rounded-t ${fill}`} style={{ height: `${pct}%`, minHeight: 3 }} />
              </div>
              {showCounts && (
                <span
                  aria-hidden="true"
                  className={`mt-1 text-xs ${isToday ? 'font-bold text-ink' : 'text-gray-600'}`}
                >
                  {fmtWeekday(d.date)}
                </span>
              )}
              <span className="sr-only">
                {fmtFull(d.date)}
                {isToday ? ' (today)' : ''}: {future ? 'upcoming' : customers(d.count)}
              </span>
            </li>
          );
        })}
      </ul>
      {!showCounts && days.length > 0 && (
        <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-gray-600">
          <span>{fmtShort(days[0].date)}</span>
          <span>{fmtShort(days[days.length - 1].date)}</span>
        </div>
      )}
    </>
  );
}

export default function BarberStatsPage() {
  const [period, setPeriod] = useState<Period>('today');

  // Fresh numbers when the barber comes back to this page or the browser tab regains focus, plus
  // live updates (below) when anyone in the salon finishes a customer, and a slow backup refresh.
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['barberStats'],
    queryFn: fetchBarberStats,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    refetchInterval: BACKUP_REFRESH_MS, // only while this tab is visible (the library pauses it in the background)
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 1,
    retryDelay: 300,
  });

  // The salon id is already loaded by the page layout (/api/barber/me); read it from that cache.
  const queryClient = useQueryClient();
  const { data: me } = useQuery<BarberMe>({ queryKey: ['barberMe'], queryFn: skipToken });
  const salonId = me?.salonId;

  // queue:updated is only a signal (it carries no customer details). It fires when any barber in the
  // salon completes a customer, so the owner's numbers move without a refresh. Bursts become one fetch.
  useEffect(() => {
    if (!salonId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const joinRoom = () => socket.emit('join:salon', { salonId });
    const onUpdated = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['barberStats'] });
      }, LIVE_DEBOUNCE_MS);
    };
    joinRoom();
    socket.on('connect', joinRoom);
    socket.on('queue:updated', onUpdated);
    return () => {
      clearTimeout(timer);
      socket.off('connect', joinRoom);
      socket.off('queue:updated', onUpdated);
      socket.emit('leave:salon', { salonId });
    };
  }, [salonId, queryClient]);

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-md p-4 md:max-w-2xl">
        <div className="animate-pulse space-y-4" aria-hidden="true">
          <div className="h-16 rounded-2xl bg-gray-200" />
          <div className="h-12 rounded-xl bg-gray-200" />
          <div className="h-44 rounded-2xl bg-gray-200" />
        </div>
        <p role="status" className="mt-4 text-center text-gray-600">Loading customers...</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="card p-6 text-center">
          <p role="alert" className="mb-4 text-red-700">
            Could not load your numbers. Check your connection and try again.
          </p>
          <button type="button" onClick={() => refetch()} className="btn-primary">
            Try again
          </button>
        </div>
      </main>
    );
  }

  const v = viewFor(data, period);
  const delta = deltaOf(v.total, v.prev, v.vs);

  return (
    <main className="mx-auto w-full max-w-md p-4 md:max-w-2xl">
      <header className="mb-3 flex items-center gap-3 rounded-2xl bg-ink p-4 text-white">
        <img src="/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 rounded-xl" />
        <div>
          <h1 className="text-xl font-semibold">Customers</h1>
          <p className="text-sm text-gray-300">Customers you have served</p>
        </div>
      </header>

      <div role="group" aria-label="Period" className="mb-4 grid grid-cols-3 gap-2">
        {PERIODS.map((p) => {
          const on = p.id === period;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => setPeriod(p.id)}
              className={`min-h-12 rounded-xl px-2 text-base ${
                on ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {isFetching && (
        <p role="status" className="mb-2 text-center text-xs text-gray-600">Updating...</p>
      )}
      {isError && (
        <p role="alert" className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-center text-sm text-amber-900">
          Could not refresh. Showing the last numbers.
        </p>
      )}

      <section aria-label="Customers served" className="mb-4 rounded-2xl border-2 border-ink bg-brand-soft p-6 text-center">
        <p className="text-sm font-bold uppercase tracking-wide text-gray-700">Customers served {v.noun}</p>
        <p data-testid="served-total" className="my-2 text-8xl font-extrabold tabular-nums text-ink">
          {v.total}
        </p>
        {v.total === 0 ? (
          <p className="text-sm text-gray-700">
            No customers served yet {v.noun}. Numbers appear here as you complete customers.
          </p>
        ) : null}
        <p className={`mt-1 text-base font-semibold ${delta.tone}`}>
          <span aria-hidden="true">{delta.symbol} </span>
          {delta.text}
        </p>
      </section>

      <section aria-label="Where they came from" className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border-2 border-gray-200 bg-white p-3 text-center">
          <p className="text-sm font-semibold text-gray-700">Via QR</p>
          <p data-testid="qr-count" className="text-3xl font-bold tabular-nums text-ink">{v.qr}</p>
        </div>
        <div className="rounded-xl border-2 border-gray-200 bg-white p-3 text-center">
          <p className="text-sm font-semibold text-gray-700">Walk-ins</p>
          <p data-testid="walkin-count" className="text-3xl font-bold tabular-nums text-ink">{v.walkIn}</p>
        </div>
      </section>

      {v.days && (
        <section aria-label="Daily breakdown" className="rounded-2xl border-2 border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            {period === 'week' ? 'Each day this week' : 'Each day this month'}
          </h2>
          <DayBars
            days={v.days}
            today={data.today}
            showCounts={period === 'week'}
            label={period === 'week' ? 'Customers served per day this week' : 'Customers served per day this month'}
          />
        </section>
      )}
    </main>
  );
}
