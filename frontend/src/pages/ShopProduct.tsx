// frontend/src/pages/ShopProduct.tsx — one product (/c/shop/p/:productId), Commerce C3.
// Photos, price, MRP, description, quantity (1…max per order) and Add to cart. The cart keeps only ids and
// quantities; the server prices everything again in the cart.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import CartButton from '../components/shop/CartButton';
import { fetchShopProduct } from '../api/shop';
import { ApiError } from '../api/client';
import { addToCart, useCart } from '../lib/cart';
import { rupees } from '../lib/money';
import { useT } from '../lib/i18n';

const TEXT = {
  hi: {
    title: 'सामान',
    back: 'दुकान पर वापस',
    loading: 'देख रहे हैं...',
    gone: 'यह सामान अभी उपलब्ध नहीं है।',
    error: 'सामान नहीं दिख पाया। थोड़ी देर बाद फिर कोशिश करें।',
    mrp: 'MRP',
    off: (n: number) => `${n}% छूट`,
    save: (r: string) => `आप ${r} बचाते हैं`,
    low: 'कुछ ही बचे हैं',
    out: 'अभी उपलब्ध नहीं',
    qty: 'मात्रा',
    less: 'एक कम',
    more: 'एक ज़्यादा',
    max: (n: number) => `एक ऑर्डर में ज़्यादा से ज़्यादा ${n}`,
    add: 'कार्ट में डालें',
    added: 'कार्ट में डाल दिया',
    inCart: (n: number) => `कार्ट में: ${n}`,
    goCart: 'कार्ट देखें',
    full: 'कार्ट में पहले से 20 अलग सामान हैं।',
    cod: 'घर पर डिलीवरी · नकद भुगतान (COD) · कोई डिलीवरी शुल्क नहीं',
    sameDay: 'आज डिलीवरी हो सकती है — ऑर्डर कन्फ़र्म होने पर बताएँगे',
    photo: (n: number) => `फ़ोटो ${n}`,
  },
  en: {
    title: 'Product',
    back: 'Back to shop',
    loading: 'Loading...',
    gone: 'This product is not available right now.',
    error: "Couldn't load the product. Please try again in a little while.",
    mrp: 'MRP',
    off: (n: number) => `${n}% off`,
    save: (r: string) => `You save ${r}`,
    low: 'Only a few left',
    out: 'Out of stock',
    qty: 'Quantity',
    less: 'One less',
    more: 'One more',
    max: (n: number) => `Up to ${n} per order`,
    add: 'Add to cart',
    added: 'Added to cart',
    inCart: (n: number) => `In cart: ${n}`,
    goCart: 'View cart',
    full: 'Your cart already has 20 different products.',
    cod: 'Home delivery · Cash on delivery · No delivery charge',
    sameDay: 'May be delivered today — we confirm after you order',
    photo: (n: number) => `Photo ${n}`,
  },
};

export default function ShopProduct() {
  const t = useT(TEXT);
  const { productId = '' } = useParams();
  const cart = useCart();
  const [qty, setQtyLocal] = useState(1);
  const [photo, setPhoto] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['shopProduct', productId], queryFn: () => fetchShopProduct(productId), retry: false });

  const header = <CustomerHeader title={t.title} backTo="/c/shop" backLabel={t.back} action={<CartButton />} />;

  if (q.isLoading) {
    return (
      <PageShell title={t.title}>
        {header}
        <div className="aspect-square w-full animate-pulse rounded-2xl bg-gray-200" aria-hidden="true" />
        <p role="status" className="mt-4 text-center text-gray-600">{t.loading}</p>
      </PageShell>
    );
  }
  if (q.isError || !q.data) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <PageShell title={t.title}>
        {header}
        <div className="card p-6 text-center">
          <p role="alert" className="text-lg text-gray-800">{gone ? t.gone : t.error}</p>
          <Link to="/c/shop" className="btn-secondary mt-6">{t.back}</Link>
        </div>
      </PageShell>
    );
  }

  const p = q.data;
  const out = p.availability === 'OUT_OF_STOCK';
  const inCart = cart.find((i) => i.productId === p.id)?.qty ?? 0;
  const room = Math.max(0, p.maxPerOrder - inCart);
  const shownQty = Math.min(qty, Math.max(1, room));
  const img = p.images[photo] ?? p.images[0];

  function add() {
    setNote(null);
    if (!addToCart(p.id, shownQty, p.sellingPricePaise, p.maxPerOrder)) return setNote(t.full);
    setNote(t.added);
    setQtyLocal(1);
  }

  return (
    <PageShell title={p.name}>
      {header}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
        {img ? (
          <img src={img.url} alt={img.alt} className="aspect-square w-full object-cover" />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center text-gray-500">—</div>
        )}
      </div>
      {p.images.length > 1 && (
        <ul className="mt-2 flex gap-2 overflow-x-auto">
          {p.images.map((im, i) => (
            <li key={im.url}>
              <button
                type="button"
                aria-label={t.photo(i + 1)}
                aria-pressed={i === photo}
                onClick={() => setPhoto(i)}
                className={`block h-16 w-16 overflow-hidden rounded-lg border-2 ${i === photo ? 'border-ink' : 'border-gray-200'}`}
              >
                <img src={im.url} alt="" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-4">
        {p.brand && <p className="text-sm font-semibold uppercase tracking-wide text-gray-600">{p.brand}</p>}
        <h1 className="text-2xl font-bold text-ink">{p.name}</h1>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3">
          <span className="text-3xl font-extrabold text-ink">{rupees(p.sellingPricePaise)}</span>
          <span className="text-base text-gray-600">
            {t.mrp} <s>{rupees(p.mrpPaise)}</s>
          </span>
          {p.discountPercent > 0 && <span className="text-base font-bold text-green-800">{t.off(p.discountPercent)}</span>}
        </p>
        {p.mrpPaise > p.sellingPricePaise && (
          <p className="text-sm text-gray-700">{t.save(rupees(p.mrpPaise - p.sellingPricePaise))}</p>
        )}
        {p.availability !== 'IN_STOCK' && (
          <p className={`mt-2 text-base font-semibold ${out ? 'text-red-800' : 'text-amber-900'}`}>{out ? t.out : t.low}</p>
        )}
        <p className="mt-3 text-sm text-gray-700">{t.cod}</p>
        {p.sameDayEligible && !out && <p className="text-sm text-gray-700">{t.sameDay}</p>}
        {p.description && <p className="mt-4 whitespace-pre-line text-base text-gray-800">{p.description}</p>}
      </section>

      {!out && (
        <section className="card mt-4 grid gap-3" aria-label={t.qty}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-base font-semibold">{t.qty}</span>
            <div className="flex items-center gap-2">
              <button type="button" aria-label={t.less} className="btn-secondary h-12 w-12 p-0 text-2xl"
                disabled={shownQty <= 1} onClick={() => setQtyLocal(Math.max(1, shownQty - 1))}>−</button>
              <span aria-live="polite" className="w-8 text-center text-xl font-bold tabular-nums">{shownQty}</span>
              <button type="button" aria-label={t.more} className="btn-secondary h-12 w-12 p-0 text-2xl"
                disabled={shownQty >= room} onClick={() => setQtyLocal(Math.min(room, shownQty + 1))}>+</button>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            {t.max(p.maxPerOrder)}
            {inCart > 0 ? ` · ${t.inCart(inCart)}` : ''}
          </p>
          <button type="button" className="btn-primary min-h-12" disabled={room === 0} onClick={add}>
            {t.add}
          </button>
          {note && <p role="status" className="text-center text-base font-semibold text-green-800">{note}</p>}
          {inCart > 0 && <Link to="/c/shop/cart" className="btn-secondary min-h-12">{t.goCart}</Link>}
        </section>
      )}
    </PageShell>
  );
}
