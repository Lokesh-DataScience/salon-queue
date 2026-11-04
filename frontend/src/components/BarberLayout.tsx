// frontend/src/components/BarberLayout.tsx
import { useEffect } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBarberSalon } from '../api/barber';
import { SESSION_EXPIRED_EVENT } from '../api/client';

// QR and Offers live under Settings, so the Settings tab stays highlighted on them.
const SETTINGS_PATHS = ['/barber/settings', '/barber/qr', '/barber/offers'];

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

export default function BarberLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Auth gate for every barber screen. Only a 401 sends the barber to login;
  // a network blip should not log anyone out.
  const { error } = useQuery({ queryKey: ['barberSalon'], queryFn: fetchBarberSalon, retry: false });

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

  return (
    <>
      <div className="barber-nav-spacer">
        <Outlet />
      </div>

      <nav aria-label="Main" className="barber-nav print:hidden">
        <div className="mx-auto grid h-[var(--barber-nav-h)] max-w-md grid-cols-3 md:max-w-2xl">
          {tabs.map((t) => {
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
        </div>
      </nav>
    </>
  );
}