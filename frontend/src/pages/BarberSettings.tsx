// frontend/src/pages/BarberSettings.tsx
// The Settings menu: one row per area, each opening its own page.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import PageShell from '../components/PageShell';
import { fetchMe, logoutBarber, fetchBarberSalonProfile, updateBarberSalonProfile } from '../api/barber';
import type { BarberSalonProfile } from '../api/barber';
import { fetchAdminMe, type AdminRole } from '../api/admin';
import { MULTI_BARBER } from '../lib/multiBarber';
import { fetchBarberFlags, flagOn } from '../api/flags';
import { DAY_NAMES, WEEK_MONDAY_FIRST, formatDays } from '../lib/salonInfo';

type Row = { to: string; title: string; hint: string };

const salonRows: Row[] = [
  { to: '/barber/settings/profile', title: 'Salon profile', hint: 'Name, phone, address and hours' },
  { to: '/barber/settings/services', title: 'Services', hint: 'What customers pick and how long each takes' },
  ...(MULTI_BARBER
    ? [{ to: '/barber/settings/team', title: 'Barbers', hint: 'Add and manage your barbers' }]
    : []),
];

const toolRows: Row[] = [
  { to: '/barber/qr', title: 'Salon QR code', hint: 'View and print your poster' },
  { to: '/barber/offers', title: 'Offers', hint: 'Rewards for customers who scan' },
];

const ADMIN_HINT: Record<AdminRole, string> = {
  FOUNDER: 'Founder, sales and tech pages',
  COFOUNDER: 'Founder, sales and tech pages',
  SALES: 'Sales page',
  TECH: 'Tech page',
};

const rowClass = 'flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-soft';

function Chevron() {
  return <span aria-hidden="true" className="text-xl text-gray-500">›</span>;
}

function RowList({ rows }: { rows: Row[] }) {
  return (
    <ul className="card divide-y divide-gray-200 overflow-hidden p-0">
      {rows.map((r) => (
        <li key={r.to}>
          <Link to={r.to} className={rowClass}>
            <span>
              <span className="block text-base font-semibold">{r.title}</span>
              <span className="block text-sm text-gray-600">{r.hint}</span>
            </span>
            <Chevron />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Owner's switch: may customers take a token from the customer app (from home)?
// The wall QR keeps working either way.
const PROFILE_KEY = ['barberSalonProfile'];

function AppJoinSwitch() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: PROFILE_KEY, queryFn: fetchBarberSalonProfile, retry: false });
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (allowAppJoin: boolean) => updateBarberSalonProfile({ allowAppJoin }),
    onMutate: () => setError(null),
    onSuccess: (salon) => queryClient.setQueryData<BarberSalonProfile>(PROFILE_KEY, salon),
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading || !profile) return null;
  const on = toggle.isPending ? !profile.allowAppJoin : profile.allowAppJoin; // show the new state while saving

  return (
    <div className="card overflow-hidden p-0">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Tokens from the app"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(!profile.allowAppJoin)}
        className={rowClass}
      >
        <span>
          <span className="block text-base font-semibold">Tokens from the app (घर से टोकन)</span>
          <span className="block text-sm text-gray-600">
            {on ? 'On: customers can take a token from home' : 'Off: only the QR code at the salon works'}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`relative h-7 w-12 shrink-0 rounded-full border-2 border-ink transition-colors ${on ? 'bg-brand' : 'bg-gray-200'}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink transition-all ${on ? 'left-[1.4rem]' : 'left-0.5'}`}
          />
        </span>
      </button>
      {error && (
        <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
          {error}
        </p>
      )}
    </div>
  );
}

// Owner's weekly off: on these days customers cannot take a token (QR or app).
// Each tap saves straight away, like the switch above. The +1 walk-in still works on an off day.
function WeeklyOffDays() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: PROFILE_KEY, queryFn: fetchBarberSalonProfile, retry: false });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (weeklyOffDays: number[]) => updateBarberSalonProfile({ weeklyOffDays }),
    onMutate: () => setError(null),
    onSuccess: (salon) => {
      queryClient.setQueryData<BarberSalonProfile>(PROFILE_KEY, salon);
      // The dashboard's "weekly off today" banner reads the public view; refresh it.
      void queryClient.invalidateQueries({ queryKey: ['publicQueue'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading || !profile) return null;
  const saved = profile.weeklyOffDays ?? [];
  const days = save.isPending && save.variables ? save.variables : saved; // show the new choice while saving
  const named = formatDays(days, 'en');

  function toggle(day: number) {
    if (save.isPending) return;
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
    if (next.length >= 7) {
      setError('Keep at least one day open.');
      return;
    }
    save.mutate(next);
  }

  return (
    <section aria-labelledby="weekly-off-title" className="card overflow-hidden p-0">
      <div className="px-4 pt-3">
        <h2 id="weekly-off-title" className="text-base font-semibold">Weekly off day (साप्ताहिक छुट्टी)</h2>
        <p className="text-sm text-gray-600">
          {named
            ? `Closed every ${named}. Customers can't take a token that day.`
            : 'Open every day. Tap a day to close the salon on it every week.'}
        </p>
      </div>
      <div role="group" aria-label="Weekly off days" className="grid grid-cols-7 gap-1.5 px-4 py-3">
        {WEEK_MONDAY_FIRST.map((d) => {
          const off = days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={off}
              aria-label={DAY_NAMES.en[d]}
              disabled={save.isPending}
              onClick={() => toggle(d)}
              className={`min-h-12 rounded-xl border-2 text-sm font-bold disabled:opacity-60 ${
                off ? 'border-ink bg-ink text-white' : 'border-gray-300 bg-white text-ink hover:bg-brand-soft'
              }`}
            >
              {DAY_NAMES.en[d].slice(0, 3)}
            </button>
          );
        })}
      </div>
      {named && (
        <p className="px-4 pb-3 text-sm text-gray-600">You can still add walk-ins with +1 if you open anyway.</p>
      )}
      {error && (
        <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
          {error}
        </p>
      )}
    </section>
  );
}

function LogoutRow() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    await logoutBarber().catch(() => {});
    navigate('/barber/login', { replace: true });
    queryClient.clear();
  }

  return (
    <div className="card overflow-hidden p-0">
      <button type="button" className={rowClass} onClick={handleLogout} disabled={busy} aria-busy={busy}>
        <span className="text-base font-semibold text-red-700">{busy ? 'Logging out...' : 'Log out'}</span>
      </button>
    </div>
  );
}

export default function BarberSettings() {
  const { data: me } = useQuery({ queryKey: ['barberMe'], queryFn: fetchMe, retry: false });
  // Only internal admin accounts get an answer here; everyone else gets null and sees no row.
  const { data: admin } = useQuery({ queryKey: ['adminMe'], queryFn: fetchAdminMe, retry: false });
  // "Report a problem" stays on unless Tech switches the bug_reports flag off.
  const { data: flags } = useQuery({ queryKey: ['barberFlags'], queryFn: fetchBarberFlags, retry: false, staleTime: 60_000 });
  // The customer list is the owner's. Staff never see the row.
  const tools: Row[] =
    me?.role === 'OWNER'
      ? [{ to: '/barber/customers', title: 'Customers', hint: 'People who joined your queue' }, ...toolRows]
      : toolRows;

  return (
    <PageShell title="Settings" width="wide">
      <h1 className="mb-5 text-2xl font-bold">Settings</h1>

      <nav aria-label="Settings" className="grid gap-6">
        <RowList rows={salonRows} />
        {me?.role === 'OWNER' && <AppJoinSwitch />}
        {me?.role === 'OWNER' && <WeeklyOffDays />}
        <RowList rows={tools} />
        {flagOn(flags, 'bug_reports', true) && (
          <RowList rows={[{ to: '/barber/report', title: 'Report a problem', hint: 'Tell us what went wrong or what you need' }]} />
        )}
        {admin && <RowList rows={[{ to: '/barber/admin', title: 'Admin', hint: ADMIN_HINT[admin.role] }]} />}
        <LogoutRow />
      </nav>
    </PageShell>
  );
}
