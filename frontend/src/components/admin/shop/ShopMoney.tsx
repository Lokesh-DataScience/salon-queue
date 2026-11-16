// frontend/src/components/admin/shop/ShopMoney.tsx — profit report and paying the supplier (Commerce C5b, §12).
// Founder + cofounder see every figure; only the founder records a payment. Paying is batched (Q9): tick the
// delivered orders you are paying for; the amount starts at what they add up to.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  fetchPendingSettlement,
  fetchSettlements,
  fetchShopReport,
  paiseToInput,
  recordSettlement,
  rupees,
  toPaise,
  type PendingSettlementOrder,
  type SettlementMethod,
} from '../../../api/shopAdmin';
import { fmtWhen } from './orderLabels';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

// India dates as YYYY-MM-DD.
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
function presets(now = new Date()) {
  const today = istDay(now);
  const [y, m] = today.split('-').map(Number);
  const first = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = istDay(new Date(Date.UTC(y, m - 1, 0, 12)));
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const weekAgo = istDay(new Date(now.getTime() - 6 * 86_400_000));
  return [
    { id: 'today', label: 'Today', from: today, to: today },
    { id: 'week', label: 'Last 7 days', from: weekAgo, to: today },
    { id: 'month', label: 'This month', from: first, to: today },
    { id: 'lastMonth', label: 'Last month', from: lastMonthStart, to: lastMonthEnd },
  ];
}

export default function ShopMoney({ readOnly }: { readOnly: boolean }) {
  return (
    <div className="grid gap-4">
      <Report />
      <PaySupplier readOnly={readOnly} />
      <History />
    </div>
  );
}

function Report() {
  const [range, setRange] = useState(() => presets()[2]);
  const [, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['shopReport', range.from, range.to], queryFn: () => fetchShopReport(range.from, range.to) });
  const r = q.data;
  const openOrder = (id: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set('view', 'orders');
    next.set('order', id);
    return next;
  });

  return (
    <section className="card grid gap-3" aria-label="Profit report">
      <h3 className="text-lg font-semibold">Profit</h3>
      <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
        {presets().map((p) => {
          const on = p.from === range.from && p.to === range.to;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => setRange(p)}
              className={`min-h-11 rounded-full px-4 text-sm ${on ? 'border-4 border-ink bg-brand font-bold' : 'border-2 border-gray-300 bg-white'}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm font-medium">
          From
          <input type="date" className="field min-h-12" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, id: 'custom', from: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          To
          <input type="date" className="field min-h-12" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, id: 'custom', to: e.target.value })} />
        </label>
      </div>
      {q.isPending && <p className="text-gray-600">Loading…</p>}
      {q.isError && (
        <p role="alert" className="text-red-700">
          {errText(q.error)}
        </p>
      )}
      {r && (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Delivered orders" value={String(r.deliveredOrders)} />
            <Tile label="Cash collected" value={rupees(r.collectedPaise)} />
            <Tile label="Supplier cost" value={rupees(r.supplierCostPaise)} />
            <Tile label="Expenses" value={rupees(r.expensesPaise)} />
            <Tile label="Gross margin" value={rupees(r.grossMarginPaise)} hint="prices − supplier cost" />
            <Tile label="Net profit" value={rupees(r.netProfitPaise)} strong hint="cash − cost − expenses" />
            <Tile label="Cancelled" value={String(r.cancelledOrders)} />
            <Tile label="Still owed to supplier" value={rupees(r.owedToSupplierPaise)} hint={`${r.owedOrders} orders, all time`} />
          </dl>
          <p className="text-xs text-gray-600">
            Orders count on the day they were delivered; expenses on the day you recorded them. Refunds and stock write-offs
            are added in the next step.
          </p>
          {r.orders.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">Delivered orders in this period</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="py-2 pr-2">Order</th>
                    <th scope="col" className="py-2 pr-2">Day</th>
                    <th scope="col" className="py-2 pr-2 text-right">Cash</th>
                    <th scope="col" className="py-2 pr-2 text-right">Cost</th>
                    <th scope="col" className="py-2 pr-2 text-right">Expenses</th>
                    <th scope="col" className="py-2 pr-2 text-right">Profit</th>
                    <th scope="col" className="py-2">Supplier</th>
                  </tr>
                </thead>
                <tbody>
                  {r.orders.map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="py-2 pr-2">
                        <button type="button" className="font-semibold text-blue-800 underline" onClick={() => openOrder(o.id)}>
                          {o.orderNumber}
                        </button>
                      </td>
                      <td className="py-2 pr-2">{o.day}</td>
                      <td className="py-2 pr-2 text-right">{rupees(o.collectedPaise)}</td>
                      <td className="py-2 pr-2 text-right">{rupees(o.costPaise)}</td>
                      <td className="py-2 pr-2 text-right">{rupees(o.expensesPaise)}</td>
                      <td className={`py-2 pr-2 text-right font-semibold ${o.profitPaise < 0 ? 'text-red-700' : ''}`}>{rupees(o.profitPaise)}</td>
                      <td className="py-2">{o.settled ? 'Paid' : 'Owed'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border-2 p-3 ${strong ? 'border-ink bg-brand-soft' : 'border-gray-200 bg-white'}`}>
      <dt className="text-xs text-gray-700">{label}</dt>
      <dd className="text-lg font-bold">{value}</dd>
      {hint && <dd className="text-xs text-gray-600">{hint}</dd>}
    </div>
  );
}

function PaySupplier({ readOnly }: { readOnly: boolean }) {
  const q = useQuery({ queryKey: ['shopPendingSettlement'], queryFn: fetchPendingSettlement });
  return (
    <section className="card grid gap-3" aria-label="Pay the supplier">
      <h3 className="text-lg font-semibold">Pay the supplier</h3>
      {q.isPending && <p className="text-gray-600">Loading…</p>}
      {q.isError && (
        <p role="alert" className="text-red-700">
          {errText(q.error)}
        </p>
      )}
      {q.data && q.data.orders.length === 0 && <p className="text-gray-700">Nothing owed: every delivered order is paid for.</p>}
      {q.data && q.data.orders.length > 0 && (
        // keyed so the ticks reset when the list changes after a payment
        <PayForm key={q.data.orders.map((o) => o.id).join()} orders={q.data.orders} readOnly={readOnly} />
      )}
    </section>
  );
}

function PayForm({ orders, readOnly }: { orders: PendingSettlementOrder[]; readOnly: boolean }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(orders.map((o) => o.id)));
  const payable = orders.filter((o) => picked.has(o.id)).reduce((n, o) => n + o.payablePaise, 0);
  const [amount, setAmount] = useState<string | null>(null); // null = follow the ticked total
  const [method, setMethod] = useState<SettlementMethod>('UPI');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const amountText = amount ?? paiseToInput(payable);
  const paise = toPaise(amountText);
  const different = paise !== null && paise !== payable;

  const pay = useMutation({
    mutationFn: recordSettlement,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shopPendingSettlement'] });
      void qc.invalidateQueries({ queryKey: ['shopSettlements'] });
      void qc.invalidateQueries({ queryKey: ['shopReport'] });
      void qc.invalidateQueries({ queryKey: ['shopOrder'] });
    },
  });

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    setAmount(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (picked.size === 0) return setProblem('Tick at least one order.');
    if (paise === null || paise <= 0) return setProblem('Enter the amount you paid, like 530.');
    if (different && note.trim().length < 3) return setProblem('The amount is different from what the orders add up to — write a short note about why.');
    setProblem('');
    pay.mutate({ orderIds: [...picked], amountPaise: paise, method, reference: reference.trim(), note: different ? note.trim() : '' });
  }

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">Delivered orders not paid for yet</legend>
        {orders.map((o) => (
          <label key={o.id} className="flex min-h-11 items-center gap-3 border-b py-1 text-sm last:border-0">
            {!readOnly && <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} />}
            <span className="font-semibold">{o.orderNumber}</span>
            <span className="text-gray-600">delivered {fmtWhen(o.deliveredAt)}</span>
            <span className="ml-auto font-semibold">{rupees(o.payablePaise)}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm">
        {readOnly ? 'Owed' : 'Ticked'}: <strong>{rupees(readOnly ? orders.reduce((n, o) => n + o.payablePaise, 0) : payable)}</strong>
        {orders[0]?.supplierName ? ` to ${orders[0].supplierName}` : ''}
      </p>
      {!readOnly && (
        <>
          <label className="grid gap-1 text-sm font-medium">
            Amount paid (₹)
            <input className="field min-h-12" inputMode="decimal" value={amountText} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {different && (
            <label className="grid gap-1 text-sm font-medium">
              Why is it different?
              <input className="field min-h-12" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Supplier gave ₹10 discount" />
            </label>
          )}
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 w-full text-sm font-medium">Paid by</legend>
            {(['UPI', 'CASH', 'BANK', 'OTHER'] as const).map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
                {{ UPI: 'UPI', CASH: 'Cash', BANK: 'Bank transfer', OTHER: 'Other' }[m]}
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1 text-sm font-medium">
            Reference (optional, e.g. UPI transaction id)
            <input className="field min-h-12" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          {(problem || pay.isError) && (
            <p role="alert" className="text-red-700">
              {problem || errText(pay.error)}
            </p>
          )}
          {pay.isSuccess && (
            <p role="status" className="font-semibold text-green-800">
              Payment saved.
            </p>
          )}
          <button type="submit" className="btn-primary min-h-12" disabled={pay.isPending}>
            Save payment to supplier
          </button>
        </>
      )}
    </form>
  );
}

function History() {
  const q = useQuery({ queryKey: ['shopSettlements'], queryFn: fetchSettlements });
  if (!q.data || q.data.settlements.length === 0) return null;
  return (
    <section className="card grid gap-2" aria-label="Payments to the supplier">
      <h3 className="text-lg font-semibold">Payments to the supplier</h3>
      <ul className="divide-y text-sm">
        {q.data.settlements.map((s) => (
          <li key={s.id} className="py-2">
            <span className="block font-semibold">
              {rupees(s.amountPaise)} · {s.method === 'BANK' ? 'Bank' : s.method === 'CASH' ? 'Cash' : s.method === 'UPI' ? 'UPI' : 'Other'} ·{' '}
              {fmtWhen(s.paidAt)}
            </span>
            <span className="block text-gray-700">
              {s.orderNumbers.join(', ')}
              {s.reference ? ` · Ref ${s.reference}` : ''}
            </span>
            {s.amountPaise !== s.payablePaise && (
              <span className="block text-amber-900">
                Orders added up to {rupees(s.payablePaise)}: {s.note}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
