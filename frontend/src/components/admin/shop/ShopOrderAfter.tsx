// frontend/src/components/admin/shop/ShopOrderAfter.tsx — after an order ends (Commerce C6, §13).
//  Cancelled after the supplier confirmed / you collected: for each item, how many went BACK TO THE SUPPLIER
//  (unopened: stock goes up, you don't pay for them) and how many are WRITTEN OFF (opened, damaged or kept:
//  you pay the supplier, it's a loss).
//  Delivered: the customer gives something back → record it, decide it (back to supplier / written off /
//  not accepted) with a refund amount, then mark the refund handed over.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  disposeShopLine,
  markShopRefundPaid,
  paiseToInput,
  recordShopReturn,
  resolveShopReturn,
  rupees,
  toPaise,
  type AdminOrderDetail,
  type AdminOrderItem,
  type OrderReturn,
} from '../../../api/shopAdmin';
import { fmtWhen } from './orderLabels';

type Detail = AdminOrderDetail;
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

function useAfterAction<I>(orderId: string, fn: (input: I) => Promise<Detail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      qc.setQueryData(['shopOrder', orderId], d);
      void qc.invalidateQueries({ queryKey: ['shopOrders'] });
      void qc.invalidateQueries({ queryKey: ['shopProducts'] });
      void qc.invalidateQueries({ queryKey: ['shopPendingSettlement'] });
      void qc.invalidateQueries({ queryKey: ['shopReport'] });
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['shopOrder', orderId] }),
  });
}

function Units({ label, value, max, onChange, id }: { label: string; value: number; max: number; onChange: (n: number) => void; id: string }) {
  return (
    <label htmlFor={id} className="grid gap-1 text-sm font-medium">
      {label}
      <select id={id} className="field min-h-12" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: max + 1 }, (_, n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Cancelled goods ──────────────────────────────────────────────────────

export function StockDecisions({ d }: { d: Detail }) {
  const waiting = d.items.filter((i) => i.stockState === 'AWAITING_DISPOSITION');
  if (waiting.length === 0) return null;
  return (
    <section className="card grid gap-3 border-2 border-amber-400" aria-label="Stock decision">
      <h3 className="text-lg font-semibold">Stock decision needed</h3>
      <p className="text-sm text-gray-700">
        The goods were confirmed or collected before this order was cancelled. Unopened items the supplier took back go back
        into stock and you don't pay for them. Anything opened, damaged or not taken back is written off: you pay the supplier
        for it.
      </p>
      {waiting.map((i) => (
        <DecisionForm key={i.id} orderId={d.order.id} item={i} />
      ))}
    </section>
  );
}

function DecisionForm({ orderId, item }: { orderId: string; item: AdminOrderItem }) {
  const save = useAfterAction(orderId, (input: { backToSupplierQty: number; writeOffQty: number; note: string }) =>
    disposeShopLine(orderId, item.id, input),
  );
  const [back, setBack] = useState(item.quantity);
  const [note, setNote] = useState('');
  const writeOff = item.quantity - back;
  const cost = item.confirmedUnitCostPaise ?? item.expectedUnitCostPaise;
  return (
    <form
      className="grid gap-2 rounded-xl border-2 border-gray-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ backToSupplierQty: back, writeOffQty: writeOff, note: note.trim() });
      }}
    >
      <p className="font-semibold">
        {item.productName} × {item.quantity}
      </p>
      <Units id={`back-${item.id}`} label="Went back to the supplier (unopened)" value={back} max={item.quantity} onChange={setBack} />
      <p className="text-sm">
        Written off: <strong>{writeOff}</strong>
        {writeOff > 0 ? ` — you pay the supplier ${rupees(cost * writeOff)}` : ''}
      </p>
      <label className="grid gap-1 text-sm font-medium">
        Note (optional, only you see it)
        <input className="field min-h-12" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {save.isError && (
        <p role="alert" className="text-red-700">
          {errText(save.error)}
        </p>
      )}
      <button type="submit" className="btn-primary min-h-12" disabled={save.isPending}>
        Save stock decision
      </button>
    </form>
  );
}

// ── Returns after delivery ───────────────────────────────────────────────

const RETURN_STATUS: Record<OrderReturn['status'], string> = { RECEIVED: 'Waiting for your decision', RESOLVED: 'Decided', REJECTED: 'Not accepted' };

export function Returns({ d, readOnly }: { d: Detail; readOnly: boolean }) {
  const returns = d.returns ?? [];
  if (d.order.status !== 'DELIVERED' || (readOnly && returns.length === 0)) return null;
  const itemName = (id: string) => d.items.find((i) => i.id === id)?.productName ?? 'Item';
  return (
    <section className="card grid gap-3" aria-label="Returns">
      <h3 className="text-lg font-semibold">Returns and refunds</h3>
      {returns.length === 0 && <p className="text-sm text-gray-700">Nothing given back. (Returns: damaged or wrong items, at delivery or within 2 days.)</p>}
      {returns.map((r) => (
        <div key={r.id} className="grid gap-2 rounded-xl border-2 border-gray-200 p-3 text-sm">
          <p>
            <span className="font-semibold">
              {itemName(r.itemId)} × {r.quantity}
            </span>{' '}
            · {fmtWhen(r.createdAt)} · {RETURN_STATUS[r.status]}
          </p>
          <p className="text-gray-700">Customer's reason: {r.reason}</p>
          {r.status === 'RESOLVED' && (
            <p className="text-gray-700">
              Back to supplier {r.restockQty} · written off {r.writeOffQty}
              {r.decisionNote ? ` · ${r.decisionNote}` : ''}
            </p>
          )}
          {r.status === 'REJECTED' && <p className="text-gray-700">Not accepted: {r.decisionNote}</p>}
          {r.refundStatus === 'PENDING' && <p className="font-semibold text-amber-900">Refund {rupees(r.refundPaise)} to hand over</p>}
          {r.refundStatus === 'PAID' && (
            <p className="text-gray-700">
              Refund {rupees(r.refundPaise)} paid {r.refundPaidAt ? fmtWhen(r.refundPaidAt) : ''} ({r.refundMethod})
            </p>
          )}
          {!readOnly && r.status === 'RECEIVED' && <ResolveForm d={d} r={r} />}
          {!readOnly && r.refundStatus === 'PENDING' && <RefundPaid orderId={d.order.id} r={r} />}
        </div>
      ))}
      {!readOnly && <NewReturn d={d} />}
    </section>
  );
}

function NewReturn({ d }: { d: Detail }) {
  const returnable = d.items.filter((i) => i.quantity - i.returnedQty > 0);
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState(returnable[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  const save = useAfterAction(d.order.id, (input: { quantity: number; reason: string }) => recordShopReturn(d.order.id, itemId, input));
  if (returnable.length === 0) return null;
  const item = returnable.find((i) => i.id === itemId) ?? returnable[0];
  const max = item.quantity - item.returnedQty;
  if (!open)
    return (
      <button type="button" className="btn-secondary min-h-12 justify-self-start" onClick={() => setOpen(true)}>
        Customer gave something back…
      </button>
    );
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length < 3) return setProblem("Write the customer's reason (at least 3 characters).");
        setProblem('');
        save.mutate({ quantity: Math.min(qty, max), reason: reason.trim() }, { onSuccess: () => { setOpen(false); setReason(''); setQty(1); } });
      }}
    >
      {returnable.length > 1 && (
        <label className="grid gap-1 text-sm font-medium">
          Which item
          <select className="field min-h-12" value={item.id} onChange={(e) => { setItemId(e.target.value); setQty(1); }}>
            {returnable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.productName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="grid gap-1 text-sm font-medium">
        How many did they give back (of {max})
        <select className="field min-h-12" value={Math.min(qty, max)} onChange={(e) => setQty(Number(e.target.value))}>
          {Array.from({ length: max }, (_, n) => (
            <option key={n + 1} value={n + 1}>
              {n + 1}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Customer's reason (the customer sees that you received it)
        <input className="field min-h-12" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong shade, bottle leaking" />
      </label>
      {(problem || save.isError) && (
        <p role="alert" className="text-red-700">
          {problem || errText(save.error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary min-h-12" disabled={save.isPending}>
          Record the return
        </button>
        <button type="button" className="btn-secondary min-h-12" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </form>
  );
}

function ResolveForm({ d, r }: { d: Detail; r: OrderReturn }) {
  const item = d.items.find((i) => i.id === r.itemId)!;
  const save = useAfterAction(d.order.id, (input: { decision: 'RESOLVED' | 'REJECTED'; backToSupplierQty: number; writeOffQty: number; refundPaise: number; note: string }) =>
    resolveShopReturn(r.id, input),
  );
  const [mode, setMode] = useState<'decide' | 'reject'>('decide');
  const [back, setBack] = useState(r.quantity);
  const [refund, setRefund] = useState(paiseToInput(item.unitPricePaise * r.quantity));
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'reject') {
      if (note.trim().length < 3) return setProblem('Write why it is not accepted (the customer sees this).');
      setProblem('');
      return save.mutate({ decision: 'REJECTED', backToSupplierQty: 0, writeOffQty: 0, refundPaise: 0, note: note.trim() });
    }
    const paise = refund.trim() === '' ? 0 : toPaise(refund);
    if (paise === null || paise < 0) return setProblem('Enter the refund in rupees, like 220 (or 0 for no refund).');
    setProblem('');
    save.mutate({ decision: 'RESOLVED', backToSupplierQty: back, writeOffQty: r.quantity - back, refundPaise: paise, note: note.trim() });
  }

  return (
    <form className="grid gap-2 border-t pt-2" onSubmit={submit}>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 w-full text-sm font-medium">Decision</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name={`mode-${r.id}`} checked={mode === 'decide'} onChange={() => setMode('decide')} />
          Accept the return
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name={`mode-${r.id}`} checked={mode === 'reject'} onChange={() => setMode('reject')} />
          Not accepted (give it back to the customer)
        </label>
      </fieldset>
      {mode === 'decide' && (
        <>
          <Units id={`rback-${r.id}`} label="Went back to the supplier (unopened)" value={back} max={r.quantity} onChange={setBack} />
          <p>Written off: <strong>{r.quantity - back}</strong></p>
          <label className="grid gap-1 font-medium">
            Refund to the customer (₹) — at most {rupees(item.unitPricePaise * r.quantity)}
            <input className="field min-h-12" inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)} />
          </label>
        </>
      )}
      <label className="grid gap-1 font-medium">
        {mode === 'reject' ? 'Why not? (the customer sees this)' : 'Note (optional, only you see it)'}
        <input className="field min-h-12" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {(problem || save.isError) && (
        <p role="alert" className="text-red-700">
          {problem || errText(save.error)}
        </p>
      )}
      <button type="submit" className={`min-h-12 ${mode === 'reject' ? 'btn-danger' : 'btn-primary'}`} disabled={save.isPending}>
        {mode === 'reject' ? 'Save: not accepted' : 'Save decision'}
      </button>
    </form>
  );
}

function RefundPaid({ orderId, r }: { orderId: string; r: OrderReturn }) {
  const save = useAfterAction(orderId, (method: 'CASH' | 'UPI' | 'OTHER') => markShopRefundPaid(r.id, method));
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'OTHER'>('CASH');
  return (
    <form
      className="grid gap-2 border-t pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(method);
      }}
    >
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 w-full text-sm font-medium">Refund paid by</legend>
        {(['CASH', 'UPI', 'OTHER'] as const).map((m) => (
          <label key={m} className="flex min-h-11 items-center gap-2">
            <input type="radio" name={`refund-${r.id}`} checked={method === m} onChange={() => setMethod(m)} />
            {{ CASH: 'Cash', UPI: 'UPI', OTHER: 'Other' }[m]}
          </label>
        ))}
      </fieldset>
      {save.isError && (
        <p role="alert" className="text-red-700">
          {errText(save.error)}
        </p>
      )}
      <button type="submit" className="btn-primary min-h-12" disabled={save.isPending}>
        I've handed over the {rupees(r.refundPaise)} refund
      </button>
    </form>
  );
}
