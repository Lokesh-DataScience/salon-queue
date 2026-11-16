// frontend/src/components/shop/ShopStrip.tsx — "Shop while you wait" row on the ticket page (Commerce C2).
// Loaded lazily, below everything else, so the ticket page itself is unchanged. Renders nothing unless the
// server says the strip should show for this salon (flag on; internal salons only during the pilot), and
// nothing on any error. Shows on waiting and completed tickets (Q12).
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchCatalog, fetchShopStatus } from '../../api/shop';
import { useT } from '../../lib/i18n';
import ProductCard from './ProductCard';

const MAX = 8;

const TEXT = {
  hi: { title: 'दुकान से खरीदें', sub: 'घर पर डिलीवरी, नकद भुगतान', all: 'सब देखें' },
  en: { title: 'From the shop', sub: 'Home delivery, cash on delivery', all: 'See all' },
};

export default function ShopStrip({ salonId }: { salonId: string }) {
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
