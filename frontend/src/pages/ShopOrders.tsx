// frontend/src/pages/ShopOrders.tsx — My Orders (/c/shop/orders), Commerce C4.
// Lists the orders this phone placed (and, after linking/recovery, those of the same customer).
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import Icon from '../components/Icon';
import { fetchMyOrders } from '../api/shopOrders';
import { STATUS_TEXT, fmtDateTime } from '../components/shop/orderStatus';
import { rupees } from '../lib/money';
import { useLang, useT } from '../lib/i18n';

const TEXT = {
  hi: {
    title: 'मेरे ऑर्डर',
    back: 'दुकान पर वापस',
    loading: 'ऑर्डर देख रहे हैं...',
    error: 'ऑर्डर नहीं दिख पाए। थोड़ी देर बाद फिर कोशिश करें।',
    empty: 'इस फ़ोन से अभी कोई ऑर्डर नहीं है।',
    shop: 'सामान देखें',
    items: (n: number) => `${n} सामान`,
    otherPhone: 'दूसरे फ़ोन पर भी देखें',
    lostPhone: 'फ़ोन बदल गया या खो गया? ऑर्डर वापस पाएँ',
  },
  en: {
    title: 'My Orders',
    back: 'Back to shop',
    loading: 'Loading your orders...',
    error: "Couldn't load your orders. Please try again in a little while.",
    empty: 'No orders from this phone yet.',
    shop: 'Browse products',
    items: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
    otherPhone: 'See these orders on another phone',
    lostPhone: 'New or lost phone? Get your orders back',
  },
};

export default function ShopOrders() {
  const t = useT(TEXT);
  const lang = useLang();
  const q = useQuery({ queryKey: ['shopMyOrders'], queryFn: fetchMyOrders, retry: false, refetchOnWindowFocus: true });

  return (
    <PageShell title={t.title}>
      <CustomerHeader title={t.title} backTo="/c/shop" backLabel={t.back} />
      {q.isLoading && <p role="status" className="card text-center text-gray-600">{t.loading}</p>}
      {q.isError && <p role="alert" className="card text-center text-red-800">{t.error}</p>}
      {q.data && q.data.length === 0 && (
        <div className="card p-6 text-center">
          <p className="text-lg text-gray-800">{t.empty}</p>
          <Link to="/c/shop" className="btn-primary mt-6">{t.shop}</Link>
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <ul className="grid gap-3">
          {q.data.map((o) => (
            <li key={o.id}>
              <Link to={`/c/shop/orders/${o.id}`} className="flex items-center gap-3 rounded-2xl border-2 border-gray-200 bg-white p-4 hover:bg-gray-50">
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold text-ink">{o.orderNumber}</span>
                  <span className="block text-base text-gray-800">{STATUS_TEXT[lang][o.status]}</span>
                  <span className="block text-sm text-gray-600">
                    {fmtDateTime(o.createdAt, lang)} · {t.items(o.itemCount)} · {rupees(o.totalPaise)}
                  </span>
                </span>
                <Icon name="chevron" className="shrink-0 text-gray-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/c/shop/link" className="btn-secondary mt-4 min-h-12 w-full">{t.otherPhone}</Link>
      <Link to="/c/shop/recover" className="mt-3 block min-h-11 py-2 text-center text-base text-blue-800 underline">{t.lostPhone}</Link>
    </PageShell>
  );
}
