// frontend/src/pages/ShopCart.tsx — the cart (/c/shop/cart), Commerce C3.
// The phone only knows product ids and quantities. Every time the cart is shown (and when the customer
// comes back to the app) the server prices it again: current prices, stock, per-order limits, the COD limit.
// A price that changed since the customer saw it is pointed out. Checkout arrives in C4.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import { quoteCart, type QuoteLine } from '../api/shop';
import { ApiError } from '../api/client';
import { acceptPrices, removeFromCart, setQty, useCart, type CartItem } from '../lib/cart';
import { rupees } from '../lib/money';
import { useT } from '../lib/i18n';

const TEXT = {
  hi: {
    title: 'कार्ट',
    back: 'दुकान पर वापस',
    empty: 'कार्ट खाली है।',
    shop: 'सामान देखें',
    checking: 'दाम देख रहे हैं...',
    error: 'दाम नहीं देख पाए। इंटरनेट देखकर फिर कोशिश करें।',
    retry: 'फिर कोशिश करें',
    closed: 'दुकान अभी बंद है।',
    gone: 'यह सामान अब नहीं मिलता',
    over: (n: number) => (n > 0 ? `एक ऑर्डर में ज़्यादा से ज़्यादा ${n}` : 'अभी उपलब्ध नहीं'),
    short: (n: number) => (n > 0 ? `अभी सिर्फ़ ${n} मिल सकते हैं` : 'अभी उपलब्ध नहीं'),
    fix: (n: number) => `${n} कर दें`,
    remove: 'हटाएँ',
    less: 'एक कम',
    more: 'एक ज़्यादा',
    qty: (name: string) => `${name} की मात्रा`,
    priceChanged: (from: string, to: string) => `दाम बदला: ${from} → ${to}`,
    pricesChangedNote: 'कुछ दाम बदल गए हैं। नए दाम नीचे दिखाए गए हैं।',
    okPrices: 'ठीक है',
    subtotal: 'सामान',
    delivery: 'डिलीवरी',
    free: 'मुफ़्त',
    total: 'कुल (डिलीवरी पर नकद)',
    cod: (r: string) => `नकद भुगतान (COD) में एक ऑर्डर ${r} तक ही हो सकता है। कुछ सामान कम करें।`,
    fixFirst: 'ऊपर लाल वाली चीज़ें ठीक करें।',
    checkout: 'ऑर्डर करें',
    soon: 'ऑर्डर करना जल्द शुरू होगा।',
    sameDay: 'आज डिलीवरी माँग सकते हैं (कन्फ़र्म होने पर ही पक्की)',
  },
  en: {
    title: 'Cart',
    back: 'Back to shop',
    empty: 'Your cart is empty.',
    shop: 'Browse products',
    checking: 'Checking prices...',
    error: "Couldn't check prices. Check your internet and try again.",
    retry: 'Try again',
    closed: 'The shop is closed right now.',
    gone: 'No longer available',
    over: (n: number) => (n > 0 ? `Up to ${n} per order` : 'Not available right now'),
    short: (n: number) => (n > 0 ? `Only ${n} can be ordered right now` : 'Not available right now'),
    fix: (n: number) => `Change to ${n}`,
    remove: 'Remove',
    less: 'One less',
    more: 'One more',
    qty: (name: string) => `Quantity of ${name}`,
    priceChanged: (from: string, to: string) => `Price changed: ${from} → ${to}`,
    pricesChangedNote: 'Some prices have changed. The new prices are shown below.',
    okPrices: 'OK',
    subtotal: 'Items',
    delivery: 'Delivery',
    free: 'Free',
    total: 'Total (cash on delivery)',
    cod: (r: string) => `Cash-on-delivery orders can be up to ${r}. Please remove some items.`,
    fixFirst: 'Please fix the items marked in red.',
    checkout: 'Place order',
    soon: 'Ordering starts soon.',
    sameDay: 'Same-day delivery can be requested (confirmed only after we check)',
  },
};

function Line({ l, item }: { l: QuoteLine; item: CartItem | undefined }) {
  const t = useT(TEXT);
  const name = l.name ?? t.gone;
  const changed = item && l.unitPricePaise !== null && l.unitPricePaise !== item.seenPricePaise;
  const fixTo = l.maxQty ?? 0;
  return (
    <li className="flex gap-3 py-3">
      {l.image ? (
        <img src={l.image.url} alt="" className="h-20 w-20 flex-none rounded-xl border object-cover" />
      ) : (
        <span aria-hidden="true" className="h-20 w-20 flex-none rounded-xl border bg-gray-50" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{name}</p>
        {l.unitPricePaise !== null && (
          <p className="text-sm text-gray-700">
            {rupees(l.unitPricePaise)} × {l.qty}
            {l.lineTotalPaise !== null && <> = <strong>{rupees(l.lineTotalPaise)}</strong></>}
          </p>
        )}
        {changed && (
          <p className="text-sm font-semibold text-amber-900">{t.priceChanged(rupees(item.seenPricePaise), rupees(l.unitPricePaise!))}</p>
        )}
        {l.problem && (
          <p role="alert" className="text-sm font-semibold text-red-800">
            {l.problem === 'UNAVAILABLE' ? t.gone : l.problem === 'OVER_LIMIT' ? t.over(fixTo) : t.short(fixTo)}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {l.problem !== 'UNAVAILABLE' && (
            <div className="flex items-center gap-1" role="group" aria-label={t.qty(name)}>
              <button type="button" aria-label={t.less} className="btn-secondary h-11 w-11 p-0 text-xl"
                onClick={() => setQty(l.productId, l.qty - 1)}>−</button>
              <span className="w-8 text-center text-lg font-bold tabular-nums">{l.qty}</span>
              <button type="button" aria-label={t.more} className="btn-secondary h-11 w-11 p-0 text-xl"
                disabled={l.problem !== null || l.qty >= 20} onClick={() => setQty(l.productId, l.qty + 1)}>+</button>
            </div>
          )}
          {(l.problem === 'OVER_LIMIT' || l.problem === 'NOT_ENOUGH_STOCK') && fixTo > 0 && (
            <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => setQty(l.productId, fixTo)}>
              {t.fix(fixTo)}
            </button>
          )}
          <button type="button" className="min-h-11 px-2 text-sm font-semibold text-gray-700 underline"
            onClick={() => removeFromCart(l.productId)}>
            {t.remove}
          </button>
        </div>
      </div>
    </li>
  );
}

export default function ShopCart() {
  const t = useT(TEXT);
  const cart = useCart();
  const items = cart.map((i) => ({ productId: i.productId, qty: i.qty }));
  const q = useQuery({
    queryKey: ['shopQuote', items],
    queryFn: () => quoteCart(items),
    enabled: items.length > 0,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true, // prices and stock may have changed while the app was in the background
  });

  const header = <CustomerHeader title={t.title} backTo="/c/shop" backLabel={t.back} />;

  if (items.length === 0) {
    return (
      <PageShell title={t.title}>
        {header}
        <div className="card p-6 text-center">
          <p className="text-lg text-gray-800">{t.empty}</p>
          <Link to="/c/shop" className="btn-primary mt-6">{t.shop}</Link>
        </div>
      </PageShell>
    );
  }

  const quote = q.data;
  const byId = new Map(cart.map((i) => [i.productId, i]));
  const priceChanges = (quote?.lines ?? []).filter(
    (l) => l.unitPricePaise !== null && byId.get(l.productId) && l.unitPricePaise !== byId.get(l.productId)!.seenPricePaise,
  );
  const overCod = quote?.orderProblems.includes('OVER_COD_LIMIT');
  const closed = q.error instanceof ApiError && q.error.status === 404;

  return (
    <PageShell title={t.title}>
      {header}
      {q.isLoading && <p role="status" className="card text-center text-gray-600">{t.checking}</p>}
      {q.isError && (
        <div className="card text-center">
          <p role="alert" className="text-red-800">{closed ? t.closed : t.error}</p>
          {!closed && <button type="button" className="btn-secondary mt-4" onClick={() => void q.refetch()}>{t.retry}</button>}
        </div>
      )}
      {quote && (
        <>
          {priceChanges.length > 0 && (
            <div role="status" className="mb-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-3">
              <p className="text-base text-amber-900">{t.pricesChangedNote}</p>
              <button type="button" className="btn-secondary mt-2 min-h-11 px-4"
                onClick={() => acceptPrices(Object.fromEntries(priceChanges.map((l) => [l.productId, l.unitPricePaise!])))}>
                {t.okPrices}
              </button>
            </div>
          )}
          <ul className="card divide-y py-0" aria-label={t.title}>
            {quote.lines.map((l) => (
              <Line key={l.productId} l={l} item={byId.get(l.productId)} />
            ))}
          </ul>
          <section className="card mt-3 grid gap-1" aria-label={t.total}>
            <p className="flex justify-between text-base"><span>{t.subtotal}</span><span>{rupees(quote.subtotalPaise)}</span></p>
            <p className="flex justify-between text-base"><span>{t.delivery}</span><span>{quote.deliveryFeePaise ? rupees(quote.deliveryFeePaise) : t.free}</span></p>
            <p className="mt-1 flex justify-between border-t pt-2 text-lg font-bold"><span>{t.total}</span><span>{rupees(quote.totalPaise)}</span></p>
            {quote.sameDayRequestable && <p className="text-sm text-gray-700">{t.sameDay}</p>}
          </section>
          {overCod && quote.codMaxOrderPaise !== null && (
            <p role="alert" className="mt-3 text-base font-semibold text-red-800">{t.cod(rupees(quote.codMaxOrderPaise))}</p>
          )}
          {quote.lines.some((l) => l.problem) && <p className="mt-3 text-base text-red-800">{t.fixFirst}</p>}
          <button type="button" className="btn-primary mt-4 min-h-12 w-full" disabled aria-describedby="checkout-soon">
            {t.checkout}
          </button>
          <p id="checkout-soon" className="mt-2 text-center text-sm text-gray-600">{t.soon}</p>
        </>
      )}
    </PageShell>
  );
}
