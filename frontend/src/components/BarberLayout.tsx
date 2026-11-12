// frontend/src/components/BarberLayout.tsx
import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMe, logoutBarber } from '../api/barber';
import { SESSION_EXPIRED_EVENT } from '../api/client';

// QR, Offers and Admin live under Settings, so the Settings tab stays highlighted on them.
const SETTINGS_PATHS = ['/barber/settings', '/barber/qr', '/barber/offers', '/barber/admin', '/barber/report'];

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const tabs = [
  {
    to: '/barber/dashboard',
    label: 'Dashboard',
    match: (p: string) => p.startsWith('/barber/dashboard'),
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
  to: '/barber/stats',
    label: 'Customers',
    match: (p: string) => p.startsWith('/barber/stats'),
    icon: (
      <svg {...iconProps}>
        <line x1="6" y1="20" x2="6" y2="12" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="18" y1="20" x2="18" y2="9" />
      </svg>
    ),
  },
  {
    to: '/barber/settings',
    label: 'Settings',
    match: (p: string) => SETTINGS_PATHS.some((s) => p.startsWith(s)),
    icon: (
      <svg {...iconProps}>
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="18" x2="20" y2="18" />
        <circle cx="9" cy="6" r="2.5" fill="currentColor" />
        <circle cx="15" cy="12" r="2.5" fill="currentColor" />
        <circle cx="8" cy="18" r="2.5" fill="currentColor" />
      </svg>
    ),
  },
];

const STAFF_HOME = '/barber/dashboard';

export default function BarberLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);

  // Auth gate for every barber screen, and the source of the signed-in person's role.
  // Only a 401 sends them to login; a network blip should not log anyone out.
  const { data: me, error } = useQuery({ queryKey: ['barberMe'], queryFn: fetchMe, retry: false });
  const isOwner = me?.role === 'OWNER';

  async function handleLogout() {
    setLoggingOut(true);
    await logoutBarber().catch(() => {});
    navigate('/barber/login', { replace: true });
    queryClient.clear();
  }

  useEffect(() => {
    function onExpired() {
      queryClient.clear();
      navigate('/barber/login', { replace: true, state: { expired: true } });
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [navigate, queryClient]);

  if ((error as { status?: number } | null)?.status === 401) {
    return <Navigate to="/barber/login" replace state={{ expired: true }} />;
  }

  // Staff accounts only ever see the Dashboard. Owner pages wait for the role to load, so a
  // staff member never gets a flash of Settings; the server refuses those requests anyway.
  if (me && !isOwner && !pathname.startsWith(STAFF_HOME)) {
    return <Navigate to={STAFF_HOME} replace />;
  }
  if (!me && !pathname.startsWith(STAFF_HOME)) {
    return <p role="status" className="p-6 text-gray-600">Loading...</p>;
  }

  const visibleTabs = me && !isOwner ? tabs.filter((t) => t.to === STAFF_HOME) : tabs;

  return (
    <>
      <div className="barber-nav-spacer">
        <Outlet />
      </div>

      <nav aria-label="Main" className="barber-nav print:hidden">
        <div
          className={`mx-auto grid h-[var(--barber-nav-h)] max-w-md md:max-w-2xl ${
            visibleTabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
          }`}
        >
          {visibleTabs.map((t) => {
            const active = t.match(pathname);
            return (
              <Link
                key={t.to}
                to={t.to}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 border-t-4 text-sm font-bold ${
                  active
                    ? 'border-ink bg-brand text-ink'
                    : 'border-transparent text-gray-700 hover:bg-brand-soft'
                }`}
              >
                {t.icon}
                {t.label}
              </Link>
            );
          })}
          {/* Staff have no Settings page, so sign-out lives here. */}
          {me && !isOwner && (
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              aria-busy={loggingOut}
              className="flex h-full flex-col items-center justify-center gap-0.5 border-t-4 border-transparent text-sm font-bold text-gray-700 hover:bg-brand-soft"
            >
              <svg {...iconProps}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {loggingOut ? 'Logging out...' : 'Log out'}
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
