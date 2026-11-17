// frontend/src/components/shop/ShopStrip.tsx — the shop on the ticket page (Commerce C2; "hero" since the
// Option A design, 17 Nov 2026).
//  variant "hero"  (waiting tickets, at the TOP of the page): a slim navy bar with the token number, people
//                  ahead and the wait (so nobody loses their place), then a full-width yellow "Shop while you
//                  wait" band with big cards to swipe. "Details" jumps down to the full token card (#token).
//  variant "row"   (completed tickets, at the bottom): the quieter "From the shop" row.
// Loaded lazily. Renders NOTHING (not even the token bar) unless the server says the shop shows for this salon
// (flag on; internal salons only during the pilot) and something is in stock, and nothing on any error: then
// the ticket page looks exactly as it did before the shop existed.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchCatalog, fetchShopStatus } from '../../api/shop';
import { useT } from '../../lib/i18n';
import ProductCard from './ProductCard';

const MAX = 8;

const TEXT = {
  hi: {
    title: 'दुकान से खरीदें',
    sub: 'घर पर डिलीवरी, नकद भुगतान',
    heroTitle: 'इंतज़ार करते हुए खरीदें',
    heroSub: 'घर पर डिलीवरी · डिलीवरी पर नकद भुगतान',
    all: 'सब देखें',
    token: 'आपका टोकन',
    ahead: (n: number) => (n === 0 ? 'आप अगले हैं' : `आपसे पहले ${n} ${n === 1 ? 'व्यक्ति' : 'लोग'}`),
    wait: (m: number) => `अनुमानित इंतज़ार ~${m} मिनट · अपने-आप अपडेट`,
    details: 'पूरा टोकन',
  },
  en: {
    title: 'From the shop',
    sub: 'Home delivery, cash on delivery',
    heroTitle: 'Shop while you wait',
    heroSub: 'Home delivery · pay cash on delivery',
    all: 'See all',
    token: 'Your token',
    ahead: (n: number) => (n === 0 ? "You're next" : `${n} ${n === 1 ? 'person' : 'people'} ahead of you`),
    wait: (m: number) => `Estimated wait ~${m} min · updates live`,
    details: 'Details',
  },
};

export interface ShopStripToken {
  number: number;
  peopleAhead: number;
  waitMinutes: number;
}

export default function ShopStrip({
  salonId,
  variant = 'row',
  token,
}: {
  salonId: string;
  variant?: 'hero' | 'row';
  token?: ShopStripToken;
}) {
  const t = useT(TEXT);
  const status = useQuery({
    queryKey: ['shopStatus', salonId],
    queryFn: () => fetchShopStatus(salonId),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const show = status.data?.showStrip === true;
  const products = useQuery({
    queryKey: ['shopCatalog', ''],
    queryFn: () => fetchCatalog(),
    enabled: show,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // In-stock products first, with a photo first among those.
  const items = (products.data ?? [])
    .filter((p) => p.availability !== 'OUT_OF_STOCK')
    .sort((a, b) => Number(!a.image) - Number(!b.image))
    .slice(0, MAX);
  if (!show || items.length === 0) return null;

  if (variant === 'hero') {
    return (
      <div className="mb-4">
        {token && (
          <div className="flex items-center gap-3 rounded-2xl bg-ink px-4 py-2.5 text-white">
            <p className="text-3xl font-extrabold leading-none tabular-nums text-brand" aria-label={`${t.token} #${token.number}`}>
              #{token.number}
            </p>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">{t.ahead(token.peopleAhead)}</p>
              <p className="text-sm text-gray-300">{t.wait(token.waitMinutes)}</p>
            </div>
            <a href="#token" className="flex min-h-11 shrink-0 items-center text-sm font-semibold text-white underline">
              {t.details}
            </a>
          </div>
        )}
        {/* full-bleed band: PageShell pads 16px each side */}
        <section aria-label={t.heroTitle} className="-mx-4 mt-4 border-y-2 border-ink bg-brand py-4">
          <div className="flex items-end justify-between gap-3 px-4">
            <div>
              <h2 className="text-2xl font-bold leading-tight text-ink">{t.heroTitle}</h2>
              <p className="text-base font-medium text-ink">{t.heroSub}</p>
            </div>
            <Link to="/c/shop" className="flex min-h-11 shrink-0 items-center text-base font-bold text-ink underline">
              {t.all}
            </Link>
          </div>
          <ul className="flex gap-3 overflow-x-auto px-4 pb-2 pt-3">
            {items.map((p) => (
              <li key={p.id} className="w-48 shrink-0">
                <Link
                  to={`/c/shop/p/${p.id}`}
                  className="block h-full rounded-2xl border-2 border-ink shadow-[0_3px_0_0_var(--color-ink)]"
                >
                  <ProductCard p={p} compact />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <section aria-label={t.title} className="card mt-4 p-0">
      <div className="flex items-end justify-between gap-3 px-4 pt-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">{t.title}</h2>
          <p className="text-sm text-gray-700">{t.sub}</p>
        </div>
        <Link to="/c/shop" className="shrink-0 text-base font-bold text-ink underline">
          {t.all}
        </Link>
      </div>
      <ul className="flex gap-3 overflow-x-auto px-4 pb-4 pt-3">
        {items.map((p) => (
          <li key={p.id} className="w-36 shrink-0">
            <Link to={`/c/shop/p/${p.id}`} className="block h-full">
              <ProductCard p={p} compact />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
