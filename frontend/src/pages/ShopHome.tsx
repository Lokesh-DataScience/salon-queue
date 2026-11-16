// frontend/src/pages/ShopHome.tsx — customer app "Shop" tab (/c/shop), Commerce Phase 1, C2.
// Products, prices and availability; tap a product to open it (C3). Ordering arrives in C4.
// Works in the installed app and in a browser tab (D5). Switched off → a friendly "not open yet" page.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import ProductCard from '../components/shop/ProductCard';
import CartButton from '../components/shop/CartButton';
import { fetchCatalog, fetchCatalogCategories } from '../api/shop';
import { ApiError } from '../api/client';
import { useLang, useT } from '../lib/i18n';

const TEXT = {
  hi: {
    title: 'दुकान',
    subtitle: 'ग्रूमिंग का सामान — घर पर डिलीवरी, नकद भुगतान',
    all: 'सभी',
    categories: 'श्रेणी',
    loading: 'सामान देख रहे हैं...',
    error: 'सामान नहीं दिख पाया। थोड़ी देर बाद फिर कोशिश करें।',
    empty: 'अभी कोई सामान नहीं है। जल्द आएगा!',
    emptyCat: 'इस श्रेणी में अभी कुछ नहीं है।',
    closedTitle: 'दुकान अभी नहीं खुली',
    closedBody: 'हम जल्द ही यहाँ ग्रूमिंग का सामान लाएँगे।',
    back: 'मेरे सैलून',
  },
  en: {
    title: 'Shop',
    subtitle: 'Grooming products — home delivery, cash on delivery',
    all: 'All',
    categories: 'Category',
    loading: 'Loading products...',
    error: "Couldn't load the products. Please try again in a little while.",
    empty: 'No products yet. Coming soon!',
    emptyCat: 'Nothing in this category yet.',
    closedTitle: "The shop isn't open yet",
    closedBody: "We'll bring grooming products here soon.",
    back: 'My salons',
  },
};

export default function ShopHome() {
  const t = useT(TEXT);
  const lang = useLang();
  const [categoryId, setCategoryId] = useState<string>('');

  const categories = useQuery({ queryKey: ['shopCatalogCategories'], queryFn: fetchCatalogCategories, retry: false, staleTime: 60_000 });
  const products = useQuery({
    queryKey: ['shopCatalog', categoryId],
    queryFn: () => fetchCatalog(categoryId || undefined),
    retry: false,
    staleTime: 60_000,
  });

  const closed = products.error instanceof ApiError && products.error.status === 404;
  if (closed) {
    return (
      <PageShell title={t.title}>
        <CustomerHeader title={t.title} />
        <div className="card p-6 text-center">
          <p className="text-xl font-bold">{t.closedTitle}</p>
          <p className="mt-2 text-gray-700">{t.closedBody}</p>
          <Link to="/c" className="btn-secondary mt-6">{t.back}</Link>
        </div>
      </PageShell>
    );
  }

  const cats = categories.data ?? [];
  return (
    <PageShell title={t.title}>
      <CustomerHeader title={t.title} subtitle={t.subtitle} action={<CartButton />} />

      {cats.length > 0 && (
        <div role="group" aria-label={t.categories} className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {[{ id: '', label: t.all }, ...cats.map((c) => ({ id: c.id, label: (lang === 'hi' && c.nameHi) || c.nameEn }))].map((c) => {
            const on = c.id === categoryId;
            return (
              <button
                key={c.id || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => setCategoryId(c.id)}
                className={`min-h-11 shrink-0 rounded-full px-4 text-base ${
                  on ? 'border-2 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      {products.isLoading && (
        <>
          <div className="grid grid-cols-2 gap-3" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-gray-200" />
            ))}
          </div>
          <p role="status" className="mt-4 text-center text-gray-600">{t.loading}</p>
        </>
      )}
      {products.isError && <p role="alert" className="card text-red-700">{t.error}</p>}
      {products.data && products.data.length === 0 && (
        <p className="card text-center text-gray-700">{categoryId ? t.emptyCat : t.empty}</p>
      )}
      {products.data && products.data.length > 0 && (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={t.title}>
            {products.data.map((p) => (
              <li key={p.id}>
                <Link to={`/c/shop/p/${p.id}`} className="block h-full rounded-2xl focus-visible:outline-4">
                  <ProductCard p={p} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}
