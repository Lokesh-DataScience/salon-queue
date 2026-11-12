// frontend/src/components/admin/FounderPanel.tsx
// Founder tab: business numbers across all real salons (internal salons are excluded on the server).
import { useQuery } from '@tanstack/react-query';
import { fetchFounderOverview, type FounderOverview } from '../../api/admin';

const fmt = (n: number) => n.toLocaleString('en-IN');

// Dates arrive as India-time calendar days. Build from parts so the phone's timezone can't shift them.
function parseYmd(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const fmtShort = (ymd: string) => parseYmd(ymd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtFull = (ymd: string) =>
  parseYmd(ymd).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

function StatCard({ label, value, sub, testId }: { label: string; value: number; sub?: string; testId: string }) {
  return (
    <div className="rounded-xl border-2 border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-700">{label}</p>
      <p data-testid={testId} className="mt-1 text-4xl font-extrabold tabular-nums text-ink">{fmt(value)}</p>
      {sub && <p className="mt-1 text-sm text-gray-600">{sub}</p>}
    </div>
  );
}

function TodayDelta({ today, yesterday }: { today: number; yesterday: number }) {
  const d = today - yesterday;
  if (d === 0) return <>Same as yesterday</>;
  return (
    <>
      <span aria-hidden="true">{d > 0 ? '▲ ' : '▼ '}</span>
      {fmt(Math.abs(d))} {d > 0 ? 'more' : 'fewer'} than yesterday
    </>
  );
}

function PeriodTable({ o }: { o: FounderOverview }) {
  const rows = [
    { label: 'Today', p: o.periods.today },
    { label: 'This week', p: o.periods.week },
    { label: 'This month', p: o.periods.month },
  ];
  return (
    <div className="overflow-x-auto rounded-xl border-2 border-gray-200 bg-white">
      <table className="w-full text-left text-base">
        <caption className="sr-only">Tickets and served customers by period</caption>
        <thead className="bg-gray-50 text-sm text-gray-700">
          <tr>
            <th scope="col" className="px-3 py-2">Period</th>
            <th scope="col" className="px-3 py-2 text-right">Tickets</th>
            <th scope="col" className="px-3 py-2 text-right">Via QR</th>
            <th scope="col" className="px-3 py-2 text-right">Walk-ins</th>
            <th scope="col" className="px-3 py-2 text-right">Served</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 tabular-nums">
          {rows.map(({ label, p }) => (
            <tr key={label}>
              <th scope="row" className="px-3 py-2 font-semibold">{label}</th>
              <td className="px-3 py-2 text-right">{fmt(p.tickets)}</td>
              <td className="px-3 py-2 text-right">{fmt(p.qr)}</td>
              <td className="px-3 py-2 text-right">{fmt(p.walkIn)}</td>
              <td className="px-3 py-2 text-right">{fmt(p.served)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyChart({ days, today }: { days: FounderOverview['days']; today: string }) {
  const max = Math.max(1, ...days.map((d) => d.tickets));
  return (
    <section aria-label="Tickets per day, last 30 days" className="rounded-xl border-2 border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">Tickets per day, last 30 days</h3>
      <ul role="list" aria-label="Tickets per day" className="flex items-end gap-0.5">
        {days.map((d) => {
          const isToday = d.date === today;
          const pct = d.tickets > 0 ? Math.max(6, Math.round((d.tickets / max) * 100)) : 0;
          return (
            <li key={d.date} aria-current={isToday ? 'date' : undefined} className="flex min-w-0 flex-1 flex-col items-center">
              <div aria-hidden="true" className="flex h-32 w-full items-end">
                <div
                  className={`w-full rounded-t ${isToday ? 'border-2 border-ink bg-brand' : 'bg-ink'}`}
                  style={{ height: `${pct}%`, minHeight: 3 }}
                />
              </div>
              <span className="sr-only">
                {fmtFull(d.date)}
                {isToday ? ' (today)' : ''}: {d.tickets} tickets, {d.served} served
              </span>
            </li>
          );
        })}
      </ul>
      {days.length > 0 && (
        <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-gray-600">
          <span>{fmtShort(days[0].date)}</span>
          <span>Today</span>
        </div>
      )}
    </section>
  );
}

export default function FounderPanel() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['founderOverview'],
    queryFn: fetchFounderOverview,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (isLoading) return <p role="status" className="text-gray-600">Loading numbers...</p>;

  if (!data) {
    return (
      <div className="card text-center">
        <p role="alert" className="mb-4 text-red-700">Couldn't load the numbers. Check your connection and try again.</p>
        <button type="button" className="btn-primary" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }

  const t = data.periods.today;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-600">Real salons only. Times in India time.</p>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-busy={isFetching}
          className="btn-secondary min-h-11 px-4 text-sm"
        >
          {isFetching ? 'Updating...' : 'Refresh'}
        </button>
      </div>
      {isError && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-center text-sm text-amber-900">
          Couldn't refresh. Showing the last numbers.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          testId="salons-total"
          label="Salons"
          value={data.salons.total}
          sub={`${fmt(data.salons.newThisMonth)} new this month`}
        />
        <StatCard
          testId="salons-active"
          label="Active salons"
          value={data.salons.active7d}
          sub="Had a ticket in the last 7 days"
        />
        <StatCard
          testId="tickets-today"
          label="Tickets today"
          value={t.tickets}
          sub={`${fmt(t.qr)} QR · ${fmt(t.walkIn)} walk-in`}
        />
        <div className="rounded-xl border-2 border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-700">Served today</p>
          <p data-testid="served-today" className="mt-1 text-4xl font-extrabold tabular-nums text-ink">{fmt(t.served)}</p>
          <p className="mt-1 text-sm text-gray-600">
            Tickets: <TodayDelta today={t.tickets} yesterday={t.ticketsYesterday} />
          </p>
        </div>
      </div>

      <PeriodTable o={data} />
      <DailyChart days={data.days} today={data.today} />
    </div>
  );
}
