// frontend/src/pages/ShopOrder.tsx — one order (/c/shop/orders/:orderId), Commerce C4.
// Status, what happened so far, items, cash to pay, delivery details, and Cancel until it leaves (D8).
// Another phone's order looks exactly like a missing one.
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import { cancelMyOrder, fetchMyOrder, type OrderDetail } from '../api/shopOrders';
import { ApiError } from '../api/client';
import { STATUS_TEXT, STATUS_TONE, fmtDateTime } from '../components/shop/orderStatus';
import { rupees } from '../lib/money';
import { useLang, useT } from '../lib/i18n';

const TEXT = {
  hi: {
    title: 'ऑर्डर',
    back: 'मेरे ऑर्डर',
    loading: 'ऑर्डर देख रहे हैं...',
    notFound: 'यह ऑर्डर इस फ़ोन पर नहीं मिला।',
    error: 'ऑर्डर नहीं दिख पाया। थोड़ी देर बाद फिर कोशिश करें।',
    placed: 'ऑर्डर हो गया! धन्यवाद।',
    placedSub: 'हम जल्द कन्फ़र्म करेंगे। पैसे डिलीवरी पर नकद दें।',
    items: 'सामान',
    total: 'डिलीवरी पर नकद देना है',
    paid: 'भुगतान हो गया',
    noPay: 'कुछ नहीं देना है',
    deliverTo: 'यहाँ डिलीवरी होगी',
    timeline: 'अब तक',
    sameDay: { NOT_REQUESTED: '', REQUESTED: 'आज डिलीवरी माँगी गई है — कन्फ़र्म होने पर बताएँगे', CONFIRMED: 'आज डिलीवरी पक्की', NOT_POSSIBLE: 'आज डिलीवरी नहीं हो पाएगी' },
    expected: (d: string) => `अनुमानित डिलीवरी: ${d}`,
    contact: 'कोई सवाल? कॉल करें:',
    cancel: 'ऑर्डर रद्द करें',
    cancelAsk: 'क्या आप यह ऑर्डर रद्द करना चाहते हैं?',
    reason: 'वजह (ज़रूरी नहीं)',
    yes: 'हाँ, रद्द करें',
    no: 'नहीं',
    cancelling: 'रद्द कर रहे हैं...',
    cancelledBy: { CUSTOMER: 'आपने रद्द किया', FOUNDER: 'दुकान ने रद्द किया' },
    events: { placed: 'ऑर्डर मिला', cancelled: 'रद्द हुआ', same_day: 'आज डिलीवरी माँगी गई', status: 'स्थिति बदली' } as Record<string, string>,
  },
  en: {
    title: 'Order',
    back: 'My Orders',
    loading: 'Loading your order...',
    notFound: "We couldn't find this order on this phone.",
    error: "Couldn't load the order. Please try again in a little while.",
    placed: 'Order placed! Thank you.',
    placedSub: "We'll confirm soon. Pay cash on delivery.",
    items: 'Items',
    total: 'To pay in cash on delivery',
    paid: 'Paid',
    noPay: 'Nothing to pay',
    deliverTo: 'Deliver to',
    timeline: 'So far',
    sameDay: { NOT_REQUESTED: '', REQUESTED: "Same-day delivery requested — we'll confirm", CONFIRMED: 'Same-day delivery confirmed', NOT_POSSIBLE: "Same-day delivery isn't possible this time" },
    expected: (d: string) => `Expected delivery: ${d}`,
    contact: 'Questions? Call:',
    cancel: 'Cancel order',
    cancelAsk: 'Do you want to cancel this order?',
    reason: 'Reason (optional)',
    yes: 'Yes, cancel it',
    no: 'No',
    cancelling: 'Cancelling...',
    cancelledBy: { CUSTOMER: 'Cancelled by you', FOUNDER: 'Cancelled by the shop' },
    events: { placed: 'Order received', cancelled: 'Cancelled', same_day: 'Same-day delivery requested', status: 'Status changed' } as Record<string, string>,
  },
};

function errText(e: unknown) {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
}

function CancelBox({ order }: { order: OrderDetail }) {
  const t = useT(TEXT);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => cancelMyOrder(order.id, reason.trim()),
    onSuccess: async (next) => {
      qc.setQueryData(['shopMyOrder', order.id], next);
      await qc.invalidateQueries({ queryKey: ['shopMyOrders'] });
      setOpen(false);
    },
  });
  if (!order.canCancel) return null;
  if (!open) {
    return (
      <button type="button" className="btn-secondary mt-4 min-h-12 w-full" onClick={() => setOpen(true)}>
        {t.cancel}
      </button>
    );
  }
  return (
    <div className="card mt-4 grid gap-3">
      <p className="text-base font-semibold">{t.cancelAsk}</p>
      <div>
        <label htmlFor="cancel-reason" className="mb-1 block text-sm font-medium">{t.reason}</label>
        <input id="cancel-reason" className="field" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {m.isError && <p role="alert" className="text-sm text-red-800">{errText(m.error)}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary min-h-12 flex-1 bg-red-700" disabled={m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? t.cancelling : t.yes}
        </button>
        <button type="button" className="btn-secondary min-h-12 px-5" onClick={() => setOpen(false)}>{t.no}</button>
      </div>
    </div>
  );
}

export default function ShopOrder() {
  const t = useT(TEXT);
  const lang = useLang();
  const { orderId = '' } = useParams();
  const location = useLocation();
  const justPlaced = (location.state as { justPlaced?: boolean } | null)?.justPlaced === true;
  const q = useQuery({
    queryKey: ['shopMyOrder', orderId],
    queryFn: () => fetchMyOrder(orderId),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000, // status changes are made by the shop; a minute is plenty
  });

  const header = <CustomerHeader title={q.data?.orderNumber ?? t.title} backTo="/c/shop/orders" backLabel={t.back} />;
  if (q.isLoading) {
    return (
      <PageShell title={t.title}>
        {header}
        <p role="status" className="card text-center text-gray-600">{t.loading}</p>
      </PageShell>
    );
  }
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <PageShell title={t.title}>
        {header}
        <p role="alert" className="card text-center text-red-800">{missing ? t.notFound : t.error}</p>
      </PageShell>
    );
  }

  const o = q.data;
  const sameDay = t.sameDay[o.sameDayState];
  const payLine = o.paymentStatus === 'VOID' ? t.noPay : o.paymentStatus === 'COLLECTED' ? t.paid : t.total;
  return (
    <PageShell title={o.orderNumber}>
      {header}
      {justPlaced && (
        <div role="status" className="mb-4 rounded-2xl border-2 border-green-500 bg-green-50 p-4 text-green-900">
          <p className="text-xl font-bold">✅ {t.placed}</p>
          <p className="mt-1 text-base">{t.placedSub}</p>
        </div>
      )}

      <div className={`rounded-2xl border-2 p-4 ${STATUS_TONE[o.status]}`}>
        <p className="text-xl font-bold">{STATUS_TEXT[lang][o.status]}</p>
        {o.status === 'CANCELLED' && o.cancelledBy && <p className="text-base">{t.cancelledBy[o.cancelledBy]}</p>}
        {sameDay && o.status !== 'CANCELLED' && <p className="mt-1 text-base">{sameDay}</p>}
        {o.expectedDeliveryDate && o.status !== 'CANCELLED' && <p className="mt-1 text-base">{t.expected(o.expectedDeliveryDate)}</p>}
        {o.expectedDeliveryNote && <p className="mt-1 text-base">{o.expectedDeliveryNote}</p>}
      </div>

      <section className="card mt-4" aria-label={t.items}>
        <h2 className="mb-1 text-lg font-semibold">{t.items}</h2>
        <ul className="divide-y">
          {o.items.map((i, n) => (
            <li key={`${i.productId ?? 'gone'}-${n}`} className="flex justify-between gap-3 py-2 text-base">
              <span className="min-w-0">{i.name} × {i.qty}</span>
              <span className="shrink-0 font-semibold">{rupees(i.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 flex justify-between border-t pt-2 text-lg font-bold">
          <span>{payLine}</span>
          <span>{o.paymentStatus === 'VOID' ? rupees(0) : rupees(o.totalPaise)}</span>
        </p>
      </section>

      <section className="card mt-4" aria-label={t.deliverTo}>
        <h2 className="mb-1 text-lg font-semibold">{t.deliverTo}</h2>
        <p className="text-base">{o.delivery.name} · {o.delivery.phone.replace(/^\+91/, '')}</p>
        <p className="text-base text-gray-800">
          {[o.delivery.addressLine1, o.delivery.addressLine2, o.delivery.landmark, o.delivery.pincode].filter(Boolean).join(', ')}
        </p>
      </section>

      <section className="card mt-4" aria-label={t.timeline}>
        <h2 className="mb-1 text-lg font-semibold">{t.timeline}</h2>
        <ol className="grid gap-1">
          {o.timeline.map((e, n) => (
            <li key={n} className="text-base">
              <span className="font-medium">{t.events[e.type] ?? (e.to ? STATUS_TEXT[lang][e.to as keyof (typeof STATUS_TEXT)['en']] ?? e.type : e.type)}</span>
              <span className="text-sm text-gray-600"> · {fmtDateTime(e.at, lang)}</span>
              {e.note && <span className="block text-sm text-gray-700">{e.note}</span>}
            </li>
          ))}
        </ol>
      </section>

      {o.contactPhone && (
        <p className="mt-4 text-center text-base">
          {t.contact} <a className="font-bold underline" href={`tel:${o.contactPhone}`}>{o.contactPhone}</a>
        </p>
      )}

      <CancelBox order={o} />
      <Link to="/c/shop" className="btn-secondary mt-4 min-h-12 w-full">{lang === 'hi' ? 'दुकान पर वापस' : 'Back to shop'}</Link>
    </PageShell>
  );
}
