// frontend/src/pages/ShopCheckout.tsx — cash-on-delivery checkout (/c/shop/checkout), Commerce C4.
// Name, phone and address are saved on the server for delivery and future orders (D12) — never on the phone.
// The phone keeps only the cart (ids + quantities) and the order key (§8.3). The server re-prices everything;
// if the total changed, the customer sees the new total and taps again. No area disclaimer (D28).
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import { quoteCart, type Quote } from '../api/shop';
import { fetchPrefill, placeOrder, saveDefaultDetails, type CustomerDetails } from '../api/shopOrders';
import { ensureShopSession } from '../lib/shopSession';
import { attemptKeyFor, clearAttempt } from '../lib/checkoutAttempt';
import { acceptPrices, clearCart, useCart } from '../lib/cart';
import { rupees } from '../lib/money';
import { useT } from '../lib/i18n';

const TEXT = {
  hi: {
    title: 'ऑर्डर करें',
    back: 'कार्ट पर वापस',
    loading: 'तैयार कर रहे हैं...',
    error: 'अभी ऑर्डर नहीं हो पा रहा। थोड़ी देर बाद फिर कोशिश करें।',
    details: 'डिलीवरी की जानकारी',
    name: 'आपका नाम',
    phone: 'मोबाइल नंबर',
    phoneHint: 'हम डिलीवरी के लिए इसी नंबर पर कॉल करेंगे।',
    line1: 'मकान नंबर / गली',
    line2: 'मोहल्ला / इलाका (ज़रूरी नहीं)',
    landmark: 'पास में कोई पहचान (ज़रूरी नहीं)',
    pincode: 'पिनकोड (ज़रूरी नहीं)',
    prefilled: 'पिछले ऑर्डर से भरा गया है। बदलना हो तो बदल दें।',
    savedPrefill: 'आपकी सेव की हुई जानकारी भरी गई है।',
    saveDefault: 'यह नई जानकारी आगे के ऑर्डर के लिए भी सेव करें',
    summary: 'आपका ऑर्डर',
    total: 'कुल — डिलीवरी पर नकद दें',
    delivery: 'डिलीवरी: मुफ़्त',
    sameDay: 'हो सके तो आज ही डिलीवरी चाहिए',
    sameDayNote: 'पक्का नहीं है — सप्लायर से पूछकर बताएँगे।',
    consent: 'मेरा नाम, फ़ोन और पता इस ऑर्डर की डिलीवरी और आगे के ऑर्डर के लिए सेव किया जाए।',
    place: (r: string) => `ऑर्डर करें · ${r} (नकद)`,
    placing: 'ऑर्डर भेज रहे हैं...',
    needConsent: 'आगे बढ़ने के लिए ऊपर वाला बॉक्स चुनें।',
    priceChanged: 'कुछ दाम बदल गए हैं। नया कुल देखें और फिर से "ऑर्डर करें" दबाएँ।',
    cartProblem: 'आपके कार्ट में कुछ बदल गया है। कार्ट ठीक करें।',
    fixCart: 'कार्ट ठीक करें',
    unknown: 'पक्का पता नहीं चला कि ऑर्डर पहुँचा या नहीं। फिर से "ऑर्डर करें" दबाएँ — ऑर्डर दो बार नहीं बनेगा।',
    mismatch: 'आपका पिछला ऑर्डर शायद पहुँच गया है। पहले "मेरे ऑर्डर" देखें।',
    myOrders: 'मेरे ऑर्डर',
  },
  en: {
    title: 'Checkout',
    back: 'Back to cart',
    loading: 'Getting ready...',
    error: "Ordering isn't working right now. Please try again in a little while.",
    details: 'Delivery details',
    name: 'Your name',
    phone: 'Mobile number',
    phoneHint: "We'll call this number for delivery.",
    line1: 'House number / street',
    line2: 'Area / locality (optional)',
    landmark: 'Landmark (optional)',
    pincode: 'Pincode (optional)',
    prefilled: 'Filled in from your last order. Change anything that is different.',
    savedPrefill: 'Filled in from your saved details.',
    saveDefault: 'Also save these details for my future orders',
    summary: 'Your order',
    total: 'Total — pay cash on delivery',
    delivery: 'Delivery: free',
    sameDay: "I'd like delivery today if possible",
    sameDayNote: "Not guaranteed — we'll confirm after checking with the supplier.",
    consent: 'Save my name, phone and address for delivering this order and for my future orders.',
    place: (r: string) => `Place order · ${r} (cash)`,
    placing: 'Placing your order...',
    needConsent: 'Please tick the box above to continue.',
    priceChanged: 'Some prices changed. Check the new total and tap "Place order" again.',
    cartProblem: 'Something in your cart changed. Please fix your cart.',
    fixCart: 'Fix my cart',
    unknown: "We couldn't confirm your order. Tap \"Place order\" again — it won't be ordered twice.",
    mismatch: 'Your earlier order may have gone through. Please check My Orders first.',
    myOrders: 'My Orders',
  },
};

const EMPTY: CustomerDetails = { name: '', phone: '', addressLine1: '', addressLine2: '', landmark: '', pincode: '' };
const tenDigits = (p: string) => p.replace(/^\+91/, '');

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  required?: boolean;
  inputMode?: 'tel' | 'numeric' | 'text';
  autoComplete?: string;
  maxLength: number;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="mb-1 block text-base font-medium">{props.label}</label>
      <input
        id={props.id}
        className="field"
        value={props.value}
        required={props.required}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        maxLength={props.maxLength}
        aria-describedby={props.hint ? `${props.id}-hint` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <p id={`${props.id}-hint`} className="mt-1 text-sm text-gray-600">{props.hint}</p>}
    </div>
  );
}

export default function ShopCheckout() {
  const t = useT(TEXT);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cart = useCart();
  const items = cart.map((i) => ({ productId: i.productId, qty: i.qty }));

  // The session (device cookie + CSRF token) is created when checkout opens, never while just browsing.
  const session = useQuery({ queryKey: ['shopSession'], queryFn: () => ensureShopSession(), retry: 1, staleTime: Infinity });
  const prefill = useQuery({ queryKey: ['shopPrefill'], queryFn: fetchPrefill, enabled: session.isSuccess, retry: false, staleTime: Infinity });
  const quoteQ = useQuery({ queryKey: ['shopQuote', items], queryFn: () => quoteCart(items), enabled: items.length > 0, retry: false });

  const [edited, setEdited] = useState<CustomerDetails | null>(null);
  const [consent, setConsent] = useState(false);
  const [sameDay, setSameDay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'warn' | 'error'; text: string; link?: 'cart' | 'orders' } | null>(null);
  const [overrideQuote, setOverrideQuote] = useState<Quote | null>(null);
  const [saveDefault, setSaveDefault] = useState(true);

  if (items.length === 0) return <Navigate to="/c/shop/cart" replace />;

  const pre = prefill.data?.prefill ?? null;
  // Only the six delivery fields: the prefill also says where it came from (source), which is not part of an order.
  const fromPrefill: CustomerDetails | null = pre
    ? { name: pre.name, phone: tenDigits(pre.phone), addressLine1: pre.addressLine1, addressLine2: pre.addressLine2 ?? '', landmark: pre.landmark ?? '', pincode: pre.pincode ?? '' }
    : null;
  const form: CustomerDetails = edited ?? fromPrefill ?? EMPTY;
  const set = (k: keyof CustomerDetails) => (v: string) => setEdited({ ...form, [k]: v });
  const quote = overrideQuote ?? quoteQ.data;
  // A verified phone that changed its saved name/address may keep the change as the new default (§10.3).
  const differsFromSaved =
    pre?.source === 'saved' &&
    (['name', 'addressLine1', 'addressLine2', 'landmark', 'pincode'] as const).some((k) => form[k].trim() !== (pre[k] ?? '').trim());

  const header = <CustomerHeader title={t.title} backTo="/c/shop/cart" backLabel={t.back} />;
  if (session.isLoading || quoteQ.isLoading) {
    return (
      <PageShell title={t.title}>
        {header}
        <p role="status" className="card text-center text-gray-600">{t.loading}</p>
      </PageShell>
    );
  }
  if (session.isError || quoteQ.isError || !quote) {
    return (
      <PageShell title={t.title}>
        {header}
        <p role="alert" className="card text-center text-red-800">{t.error}</p>
      </PageShell>
    );
  }
  if (!quote.ok && !notice) return <Navigate to="/c/shop/cart" replace />; // problems are fixed in the cart

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !quote) return;
    setNotice(null);
    if (!consent) return setNotice({ tone: 'error', text: t.needConsent });
    setBusy(true);
    try {
      const key = await attemptKeyFor(items);
      const r = await placeOrder(key, {
        items,
        expectedTotalPaise: quote.totalPaise,
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2,
          landmark: form.landmark,
          pincode: form.pincode,
        },
        consent: true,
        requestSameDay: sameDay && quote.sameDayRequestable,
      });
      switch (r.kind) {
        case 'CREATED':
        case 'EXISTING':
          clearAttempt();
          clearCart();
          if (differsFromSaved && saveDefault) {
            const { name, addressLine1, addressLine2, landmark, pincode } = form;
            await saveDefaultDetails({ name: name.trim(), addressLine1, addressLine2, landmark, pincode }).catch(() => undefined);
          }
          await qc.invalidateQueries({ queryKey: ['shopMyOrders'] });
          navigate(`/c/shop/orders/${r.orderId}`, { replace: true, state: { justPlaced: true } });
          return;
        case 'PRICE_CHANGED':
          setOverrideQuote(r.quote);
          acceptPrices(Object.fromEntries(r.quote.lines.filter((l) => l.unitPricePaise !== null).map((l) => [l.productId, l.unitPricePaise!])));
          setNotice({ tone: 'warn', text: t.priceChanged });
          return;
        case 'CART_PROBLEM':
          setOverrideQuote(r.quote);
          setNotice({ tone: 'error', text: t.cartProblem, link: 'cart' });
          return;
        case 'TOO_MANY_OPEN_ORDERS':
          setNotice({ tone: 'error', text: r.message, link: 'orders' });
          return;
        case 'IDEMPOTENCY_MISMATCH':
          clearAttempt();
          setNotice({ tone: 'error', text: t.mismatch, link: 'orders' });
          return;
        case 'INVALID': {
          const first = r.fieldErrors ? Object.values(r.fieldErrors).flat().find(Boolean) : undefined;
          setNotice({ tone: 'error', text: first ?? (r.message || t.error) });
          return;
        }
        case 'UNKNOWN':
          // The order may exist. Keep the same key so tapping again returns it instead of making a second one.
          setNotice({ tone: 'warn', text: t.unknown });
          return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title={t.title}>
      {header}
      <form onSubmit={submit} noValidate className="grid gap-4">
        <section className="card grid gap-3" aria-label={t.details}>
          <h2 className="text-lg font-semibold">{t.details}</h2>
          {fromPrefill && !edited && <p className="text-sm text-gray-700">{pre?.source === 'saved' ? t.savedPrefill : t.prefilled}</p>}
          <Field id="co-name" label={t.name} value={form.name} onChange={set('name')} required autoComplete="name" maxLength={80} />
          <Field id="co-phone" label={t.phone} value={form.phone} onChange={set('phone')} required inputMode="tel"
            autoComplete="tel-national" maxLength={14} hint={t.phoneHint} />
          <Field id="co-line1" label={t.line1} value={form.addressLine1} onChange={set('addressLine1')} required
            autoComplete="address-line1" maxLength={200} />
          <Field id="co-line2" label={t.line2} value={form.addressLine2} onChange={set('addressLine2')}
            autoComplete="address-line2" maxLength={200} />
          <Field id="co-landmark" label={t.landmark} value={form.landmark} onChange={set('landmark')} maxLength={120} />
          <Field id="co-pin" label={t.pincode} value={form.pincode} onChange={set('pincode')} inputMode="numeric"
            autoComplete="postal-code" maxLength={6} />
        </section>

        <section className="card grid gap-2" aria-label={t.summary}>
          <h2 className="text-lg font-semibold">{t.summary}</h2>
          <ul className="divide-y">
            {quote.lines.map((l) => (
              <li key={l.productId} className="flex justify-between gap-3 py-2 text-base">
                <span className="min-w-0">{l.name} × {l.qty}</span>
                <span className="shrink-0 font-semibold">{l.lineTotalPaise !== null ? rupees(l.lineTotalPaise) : '—'}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-gray-700">{t.delivery}</p>
          <p className="flex justify-between border-t pt-2 text-lg font-bold"><span>{t.total}</span><span>{rupees(quote.totalPaise)}</span></p>
          {quote.sameDayRequestable && (
            <label className="mt-2 flex min-h-11 items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={sameDay} onChange={(e) => setSameDay(e.target.checked)} />
              <span>
                {t.sameDay}
                <span className="block text-sm text-gray-600">{t.sameDayNote}</span>
              </span>
            </label>
          )}
        </section>

        {differsFromSaved && (
          <label className="flex min-h-11 items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
            <span className="text-base">{t.saveDefault}</span>
          </label>
        )}

        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="text-base">{t.consent}</span>
        </label>

        {notice && (
          <div role="alert" className={`rounded-2xl border-2 p-3 ${notice.tone === 'warn' ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
            <p>{notice.text}</p>
            {notice.link === 'cart' && <Link to="/c/shop/cart" className="btn-secondary mt-2 min-h-11">{t.fixCart}</Link>}
            {notice.link === 'orders' && <Link to="/c/shop/orders" className="btn-secondary mt-2 min-h-11">{t.myOrders}</Link>}
          </div>
        )}

        <button type="submit" className="btn-primary min-h-14 text-lg" disabled={busy || (!quote.ok && notice?.link === 'cart')}>
          {busy ? t.placing : t.place(rupees(quote.totalPaise))}
        </button>
      </form>
    </PageShell>
  );
}
