// frontend/src/components/CustomerChrome.tsx
// Rendered once in App. On customer pages (anything outside /barber) it:
//   - switches the page font to Hind and sets <html lang> to the chosen language
//   - shows an "offline" strip when the phone loses its connection
//   - shows the bottom bar on the customer-app pages (and on ticket pages inside the installed app)
// Barber pages are left exactly as they were.
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon, { type IconName } from './Icon';
import { useLang, useT } from '../lib/i18n';
import { useOnline } from '../hooks/useOnline';
import { isInstalledApp } from '../lib/appManifest';

export function isCustomerPath(pathname: string): boolean {
  return !/^\/barber(\/|$)/.test(pathname);
}

// The join flow (/c/s/:code/join) stays focused: no bar while the customer fills it in.
export function showsBottomNav(pathname: string, installed: boolean): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/c' || p === '/c/tokens' || p === '/c/scan' || p === '/c/history') return true;
  if (/^\/c\/s\/[^/]+$/.test(p)) return true;
  return installed && p.startsWith('/tickets/');
}

interface Tab {
  to: string;
  icon: IconName;
  key: 'salons' | 'tokens' | 'scan' | 'history';
  active: (p: string) => boolean;
}

const TABS: Tab[] = [
  { to: '/c', icon: 'store', key: 'salons', active: (p) => p === '/c' || p === '/c/' || p.startsWith('/c/s/') },
  { to: '/c/tokens', icon: 'ticket', key: 'tokens', active: (p) => p.startsWith('/c/tokens') || p.startsWith('/tickets/') },
  { to: '/c/scan', icon: 'camera', key: 'scan', active: (p) => p.startsWith('/c/scan') },
  { to: '/c/history', icon: 'clock', key: 'history', active: (p) => p.startsWith('/c/history') },
];

const TEXT = {
  hi: {
    nav: 'मुख्य मेनू',
    salons: 'सैलून',
    tokens: 'टोकन',
    scan: 'QR स्कैन',
    history: 'इतिहास',
    offline: 'इंटरनेट बंद है। लाइन अभी अपडेट नहीं हो रही।',
  },
  en: {
    nav: 'Main menu',
    salons: 'Salons',
    tokens: 'Tokens',
    scan: 'Scan QR',
    history: 'History',
    offline: "You're offline. The queue isn't updating right now.",
  },
};

export default function CustomerChrome() {
  const { pathname } = useLocation();
  const lang = useLang();
  const t = useT(TEXT);
  const online = useOnline();
  const customer = isCustomerPath(pathname);
  const nav = customer && showsBottomNav(pathname, isInstalledApp());

  useEffect(() => {
    document.body.classList.toggle('c-font', customer);
    document.body.classList.toggle('has-c-nav', nav);
    document.documentElement.lang = customer ? lang : 'en';
  }, [customer, nav, lang]);

  if (!customer) return null;

  return (
    <>
      {!online && (
        <div role="status" className="c-offline">
          <Icon name="wifiOff" size={20} className="shrink-0" />
          <span>{t.offline}</span>
        </div>
      )}
      {nav && (
        <nav aria-label={t.nav} className="c-nav">
          <ul className="mx-auto flex max-w-md">
            {TABS.map((tab) => {
              const on = tab.active(pathname);
              return (
                <li key={tab.key} className="flex-1">
                  <Link
                    to={tab.to}
                    aria-current={on ? 'page' : undefined}
                    className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-sm ${
                      on ? 'font-bold text-ink' : 'font-medium text-gray-600'
                    }`}
                  >
                    <Icon name={tab.icon} />
                    <span>{t[tab.key]}</span>
                    <span aria-hidden="true" className={`mt-0.5 h-1 w-8 rounded-full ${on ? 'bg-brand' : 'bg-transparent'}`} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </>
  );
}
