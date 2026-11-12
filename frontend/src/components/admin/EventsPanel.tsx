// frontend/src/components/admin/EventsPanel.tsx
// Tech → Errors & sign-ins: server errors, why people got signed out, and rate limits hit.
// Codes and route shapes only — no names, phone numbers, messages or IP addresses are ever stored.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTechEvents, type EventGroup } from '../../api/admin';
import { ago } from './TechPanel';

// Plain-English meaning of each sign-in code. These are the reasons a barber gets logged out.
export const AUTH_MEANING: Record<string, string> = {
  REFRESH_REUSED:
    'A sign-in token was used twice. Usually two requests refreshing at the same moment, or a phone restoring an old cookie. This logs the barber out.',
  REFRESH_EXPIRED: 'Signed out after 7 days without using the app.',
  REFRESH_INVALID: 'The sign-in cookie was damaged or made with an old secret.',
  REFRESH_OLD_FORMAT: 'A very old sign-in cookie from before October. Signing in again fixes it.',
  REFRESH_NO_COOKIE: 'The app tried to stay signed in but the phone sent no sign-in cookie (cleared, blocked or a private tab).',
  STAFF_NOT_FOUND: 'The account no longer exists.',
  STAFF_INACTIVE: 'The account was switched off by the salon owner.',
  SALON_SUSPENDED: 'The salon is suspended.',
  PASSWORD_RESET: 'Signed out because the founder reset the password.',
  LOGIN_FAILED: 'Wrong email/phone or password.',
  LOGIN_REFUSED: 'Correct password, but the account is switched off or the salon is suspended.',
};

const LIMIT_MEANING: Record<string, string> = {
  global: 'Too many requests of any kind from one network',
  join: 'Too many queue joins from one network',
  login: 'Too many failed sign-ins',
  nearby: 'Too many salon searches or QR lookups',
  ticket: 'Too many ticket-page requests',
  register: 'Too many salon sign-ups',
  admin: 'Too many admin page requests',
};

function GroupList({ title, empty, groups, meaning }: {
  title: string;
  empty: string;
  groups: EventGroup[];
  meaning?: (g: EventGroup) => string | undefined;
}) {
  return (
    <section aria-label={title} className="card">
      <h3 className="mb-1 text-base font-semibold">{title}</h3>
      {groups.length === 0 ? (
        <p className="text-sm text-gray-600">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {groups.map((g) => (
            <li key={`${g.code}|${g.route ?? ''}`} className="py-2">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-sm font-semibold">{g.code}</span>
                <span className="text-sm tabular-nums">× {g.count.toLocaleString('en-IN')}</span>
                {g.accounts > 0 && (
                  <span className="text-xs text-gray-600">({g.accounts} {g.accounts === 1 ? 'account' : 'accounts'})</span>
                )}
                <span className="text-xs text-gray-600">last {ago(g.lastAt)}</span>
              </p>
              {g.route && <p className="font-mono text-xs text-gray-700">{g.route}</p>}
              {meaning?.(g) && <p className="text-sm text-gray-700">{meaning(g)}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function EventsPanel() {
  const [days, setDays] = useState<1 | 7>(1);
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['techEvents', days],
    queryFn: () => fetchTechEvents(days),
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <div role="group" aria-label="Period" className="grid grid-cols-2 gap-2">
          {([1, 7] as const).map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
              className={`min-h-11 rounded-xl px-3 text-sm ${
                days === d ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
              }`}>
              {d === 1 ? 'Last 24 hours' : 'Last 7 days'}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching} aria-busy={isFetching}
          className="btn-secondary min-h-11 px-4 text-sm">
          {isFetching ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {isLoading && <p role="status" className="text-gray-600">Loading the log...</p>}
      {!isLoading && !data && (
        <div className="card text-center">
          <p role="alert" className="mb-4 text-red-700">Couldn't load the log. Please try again.</p>
          <button type="button" className="btn-primary" onClick={() => refetch()}>Try again</button>
        </div>
      )}
      {isError && data && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-center text-sm text-amber-900">
          Couldn't refresh. Showing the last log.
        </p>
      )}

      {data && (
        <>
          <p className="text-sm text-gray-600">
            {data.total.toLocaleString('en-IN')} events{data.truncated ? ' (showing the newest 5,000)' : ''}. Kept for 14 days.
          </p>
          <GroupList
            title="Sign-in problems"
            empty="No sign-in problems."
            groups={data.auth}
            meaning={(g) => AUTH_MEANING[g.code]}
          />
          <GroupList title="Server errors" empty="No server errors." groups={data.errors} />
          <GroupList
            title="Rate limits hit"
            empty="No rate limits hit."
            groups={data.rateLimits}
            meaning={(g) => LIMIT_MEANING[g.code]}
          />
        </>
      )}
    </div>
  );
}
