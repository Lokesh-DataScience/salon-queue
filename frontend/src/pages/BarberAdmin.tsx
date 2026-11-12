// frontend/src/pages/BarberAdmin.tsx
// Internal admin area, opened from Settings. Shows only the sections this account's role allows.
// Hiding things here is cosmetic: every /api/admin route checks the role on the server.
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell';
import { fetchAdminMe, fetchAdminSection, type AdminSection } from '../api/admin';
import FounderSection from '../components/admin/FounderSection';
import SalesPanel from '../components/admin/SalesPanel';
import TechPanel from '../components/admin/TechPanel';

const LABELS: Record<AdminSection, string> = {
  founder: 'Founder',
  sales: 'Sales',
  tech: 'Tech',
};

function BackToSettings() {
  return (
    <Link to="/barber/settings" className="mb-4 inline-block text-sm font-semibold text-gray-700 underline">
      ‹ Settings
    </Link>
  );
}

function SectionPanel({ section }: { section: AdminSection }) {
  const { isLoading, error } = useQuery({
    queryKey: ['adminSection', section],
    queryFn: () => fetchAdminSection(section),
    retry: false,
  });

  if (isLoading) return <p role="status" className="text-gray-600">Loading...</p>;
  if (error) return <p role="alert" className="text-red-600">Couldn't load this page. Please try again.</p>;
  return (
    <div className="card">
      <p className="text-gray-600">{LABELS[section]} tools will appear here.</p>
    </div>
  );
}

export default function BarberAdmin() {
  const { data: admin, isLoading, error } = useQuery({ queryKey: ['adminMe'], queryFn: fetchAdminMe, retry: false });
  const [params, setParams] = useSearchParams();

  if (isLoading) {
    return (
      <PageShell title="Admin">
        <p role="status" className="text-gray-600">Loading...</p>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="Admin">
        <BackToSettings />
        <p role="alert" className="text-red-600">Couldn't load this page. Please try again.</p>
      </PageShell>
    );
  }

  // Not an admin: look exactly like a page that doesn't exist.
  if (!admin) {
    return (
      <PageShell title="Page not found">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-gray-600">That page doesn't exist.</p>
        <Link to="/barber/settings" className="btn-secondary mt-6">Back to Settings</Link>
      </PageShell>
    );
  }

  const requested = params.get('tab') as AdminSection | null;
  const active: AdminSection = requested && admin.sections.includes(requested) ? requested : admin.sections[0];
  const hasTabs = admin.sections.length > 1;

  return (
    <PageShell title="Admin" width="wide">
      <BackToSettings />
      <h1 className="mb-5 text-2xl font-bold">Admin</h1>

      {hasTabs && (
        <div role="tablist" aria-label="Admin sections" className="mb-5 grid grid-cols-3 gap-2">
          {admin.sections.map((s) => {
            const selected = s === active;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                id={`admin-tab-${s}`}
                aria-selected={selected}
                aria-controls={`admin-panel-${s}`}
                onClick={() => setParams({ tab: s }, { replace: true })}
                className={`min-h-12 rounded-xl border-2 px-3 text-base font-bold ${
                  selected ? 'border-ink bg-brand text-ink' : 'border-gray-200 bg-white text-gray-700 hover:bg-brand-soft'
                }`}
              >
                {LABELS[s]}
              </button>
            );
          })}
        </div>
      )}

      <section
        role={hasTabs ? 'tabpanel' : undefined}
        id={`admin-panel-${active}`}
        aria-labelledby={hasTabs ? `admin-tab-${active}` : undefined}
      >
        <h2 className="mb-3 text-lg font-semibold">{LABELS[active]}</h2>
        {active === 'founder' ? <FounderSection /> : active === 'sales' ? <SalesPanel /> : active === 'tech' ? <TechPanel /> : <SectionPanel section={active} />}
      </section>
    </PageShell>
  );
}
