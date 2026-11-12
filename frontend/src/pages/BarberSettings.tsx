// frontend/src/pages/BarberSettings.tsx
// The Settings menu: one row per area, each opening its own page.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import PageShell from '../components/PageShell';
import { fetchMe, logoutBarber } from '../api/barber';
import { fetchAdminMe, type AdminRole } from '../api/admin';
import { MULTI_BARBER } from '../lib/multiBarber';
import { fetchBarberFlags, flagOn } from '../api/flags';

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
