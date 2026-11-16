// frontend/src/components/admin/shop/ShopOrderDetail.tsx — one order, and the next step for it (Commerce C5a, §7.2).
// Each action sends the status the screen was showing (expectedFrom): a stale screen or a double tap gets a clear
// "changed since you opened it" instead of moving the order twice. Cofounder: sees everything, no buttons.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addShopExpense,
  fetchShopOrder,
  fetchSupplierText,
  paiseToInput,
  recordShopCod,
  rupees,
  setShopDeliveryExpectation,
  toPaise,
  transitionShopOrder,
  voidShopExpense,
  type AdminOrderDetail,
  type ExpenseKind,
  type TransitionInput,
} from '../../../api/shopAdmin';
import ShopCustomerAccess from './ShopCustomerAccess';
import { StatusPill } from './ShopOrders';
import { eventLabel, fmtWhen } from './orderLabels';

type Detail = AdminOrderDetail;
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

function useOrderAction<I>(orderId: string, fn: (input: I) => Promise<Detail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      qc.setQueryData(['shopOrder', orderId], d);
      void qc.invalidateQueries({ queryKey: ['shopOrders'] });
      void qc.invalidateQueries({ queryKey: ['shopProducts'] }); // stock changed
    },
    // A 409 means the order moved elsewhere: show the fresh order under the message.
    onError: () => void qc.invalidateQueries({ queryKey: ['shopOrder', orderId] }),
  });
}

export default function ShopOrderDetail({ orderId, readOnly, onBack }: { orderId: string; readOnly: boolean; onBack: () => void }) {
  const q = useQuery({ queryKey: ['shopOrder', orderId], queryFn: () => fetchShopOrder(orderId) });

  return (
    <div className="grid gap-4">
      <button type="button" className="btn-secondary min-h-12 justify-self-start" onClick={onBack}>
        ← All orders
      </button>
      {q.isPending && <p className="text-gray-600">Loading order…</p>}
      {q.isError && (
        <p role="alert" className="text-red-700">
          {errText(q.error)}
        </p>
      )}
      {q.data && <OrderBody d={q.data} readOnly={readOnly} />}
    </div>
  );
}

function OrderBody({ d, readOnly }: { d: Detail; readOnly: boolean }) {
  const o = d.order;
  const c = o.customer;
  const finished = o.status === 'DELIVERED' || o.status === 'CANCELLED';
  return (
    <>
      <section className="card grid gap-2" aria-label="Order">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-bold">{o.orderNumber}</h3>
          <StatusPill status={o.status} />
          {o.fromSalon && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">From a salon queue</span>}
        </div>
        <p className="text-sm text-gray-700">
          Placed {fmtWhen(o.createdAt)} · {rupees(o.totalPaise)} cash on delivery
        </p>
        {o.sameDayState !== 'NOT_REQUESTED' && (
          <p className="text-sm font-semibold text-blue-900">
            Same day:{' '}
            {{ REQUESTED: 'customer asked for today — decide when you confirm', CONFIRMED: 'confirmed', NOT_POSSIBLE: 'not possible' }[o.sameDayState] ?? ''}
          </p>
        )}
        {o.expectedDeliveryDate && (
          <p className="text-sm">
            Expected delivery: <strong>{o.expectedDeliveryDate}</strong>
            {o.expectedDeliveryNote ? ` · ${o.expectedDeliveryNote}` : ''}
          </p>
        )}
        {o.status === 'CANCELLED' && (
          <p className="text-sm text-gray-800">
            Cancelled by {o.cancelledBy === 'CUSTOMER' ? 'the customer' : 'you'}: {o.cancelReason || '—'}
          </p>
        )}
        {o.status === 'DELIVERED' && o.cod.collectedPaise !== null && (
          <p className="text-sm text-gray-800">
            Cash collected {rupees(o.cod.collectedPaise)}
            {o.cod.collectedAt ? ` on ${fmtWhen(o.cod.collectedAt)}` : ''}
            {o.cod.mismatchNote ? ` — note: ${o.cod.mismatchNote}` : ''}
          </p>
        )}
      </section>

      <section className="card grid gap-1" aria-label="Customer">
        <h3 className="text-lg font-semibold">Deliver to</h3>
        <p className="font-medium">{c.name}</p>
        <p>
          <a className="text-blue-800 underline" href={`tel:${c.phone}`}>
            {c.phone}
          </a>
        </p>
        <p className="text-sm text-gray-800">
          {[c.addressLine1, c.addressLine2, c.landmark && `Near ${c.landmark}`, c.pincode].filter(Boolean).join(', ')}
        </p>
        <CustomerAccessToggle customerId={o.customerId} readOnly={readOnly} />
      </section>

      <section className="card grid gap-2" aria-label="Items">
        <h3 className="text-lg font-semibold">Items</h3>
        <ul className="divide-y">
          {d.items.map((i) => (
            <li key={i.id} className="py-2 text-sm">
              <span className="block font-medium">
                {i.productName} × {i.quantity}
              </span>
              <span className="block text-gray-700">
                {i.sku} · {rupees(i.unitPricePaise)} each = {rupees(i.lineTotalPaise)} · Cost{' '}
                {rupees(i.confirmedUnitCostPaise ?? i.expectedUnitCostPaise)} {i.confirmedUnitCostPaise === null ? '(expected)' : '(confirmed)'}
              </span>
              {i.stockState === 'AWAITING_DISPOSITION' && (
                <span className="block font-semibold text-amber-900">Waiting for your stock decision (comes in the next step)</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Cost {rupees(d.finance.costPaise)} · Profit <strong>{rupees(d.finance.grossProfitPaise)}</strong>{' '}
          {d.finance.costsConfirmed ? '' : '(expected — confirmed once the supplier gives rates)'}
        </p>
        {d.finance.expensesPaise > 0 && (
          <p className="text-sm">
            After expenses ({rupees(d.finance.expensesPaise)}): <strong>{rupees(d.finance.netProfitPaise)}</strong>
          </p>
        )}
        {o.status === 'DELIVERED' && (
          <p className="text-sm text-gray-700">Supplier: {o.supplierSettled ? 'paid' : 'not paid yet (Money tab)'}</p>
        )}
      </section>

      <Expenses d={d} readOnly={readOnly} />

      {!readOnly && !finished && <Actions d={d} />}
      {!readOnly && !finished && <DeliveryBox d={d} />}

      <section className="card grid gap-1" aria-label="History">
        <h3 className="text-lg font-semibold">History</h3>
        <ol className="grid gap-1 text-sm">
          {d.events.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{eventLabel(e)}</span>
              <span className="text-gray-600"> · {fmtWhen(e.at)}</span>
              {!e.customerVisible && <span className="text-gray-500"> · only you see this</span>}
              {e.note && <span className="block text-gray-700">{e.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Actions({ d }: { d: Detail }) {
  const o = d.order;
  const move = useOrderAction(o.id, (input: Omit<TransitionInput, 'expectedFrom'>) =>
    transitionShopOrder(o.id, { ...input, expectedFrom: o.status }),
  );
  const [cancelling, setCancelling] = useState(false);
  const canCancel = o.status !== 'OUT_FOR_DELIVERY';

  return (
    <section className="card grid gap-3" aria-label="Next step">
      <h3 className="text-lg font-semibold">Next step</h3>
      {move.isError && (
        <p role="alert" className="rounded-lg border-2 border-red-300 bg-red-50 p-2 text-red-800">
          {errText(move.error)}
        </p>
      )}

      {o.status === 'PLACED' && (
        <>
          <SupplierMessage orderId={o.id} />
          <button type="button" className="btn-primary min-h-12" disabled={move.isPending} onClick={() => move.mutate({ to: 'SUPPLIER_PENDING' })}>
            I've asked the supplier
          </button>
        </>
      )}
      {o.status === 'SUPPLIER_PENDING' && <ConfirmBox d={d} move={move} />}
      {o.status === 'SUPPLIER_CONFIRMED' && (
        <button type="button" className="btn-primary min-h-12" disabled={move.isPending} onClick={() => move.mutate({ to: 'COLLECTED' })}>
          I've collected it from the supplier
        </button>
      )}
      {(o.status === 'COLLECTED' || o.status === 'DELIVERY_FAILED') && (
        <button type="button" className="btn-primary min-h-12" disabled={move.isPending} onClick={() => move.mutate({ to: 'OUT_FOR_DELIVERY' })}>
          {o.status === 'COLLECTED' ? 'Out for delivery' : 'Try delivering again'}
        </button>
      )}
      {o.status === 'OUT_FOR_DELIVERY' && (
        <>
          <CodBox d={d} />
          <ReasonForm
            label="Delivery failed — what happened? (the customer sees this)"
            button="Delivery failed"
            busy={move.isPending}
            onSubmit={(note) => move.mutate({ to: 'DELIVERY_FAILED', note })}
          />
        </>
      )}

      {canCancel && !cancelling && (
        <button type="button" className="btn-secondary min-h-12" onClick={() => setCancelling(true)}>
          Cancel this order…
        </button>
      )}
      {canCancel && cancelling && (
        <ReasonForm
          label="Why are you cancelling? (the customer sees this)"
          button="Cancel order"
          danger
          busy={move.isPending}
          extra={
            o.status === 'SUPPLIER_CONFIRMED' || o.status === 'COLLECTED' || o.status === 'DELIVERY_FAILED'
              ? "The goods were already confirmed or collected, so you'll decide later whether they go back into stock."
              : undefined
          }
          onSubmit={(note) => move.mutate({ to: 'CANCELLED', note })}
          onCancel={() => setCancelling(false)}
        />
      )}
    </section>
  );
}

function SupplierMessage({ orderId }: { orderId: string }) {
  const q = useQuery({ queryKey: ['shopSupplierText', orderId], queryFn: () => fetchSupplierText(orderId) });
  const [copied, setCopied] = useState(false);
  if (!q.data) return q.isError ? <p className="text-red-700">{errText(q.error)}</p> : null;
  return (
    <div className="grid gap-2">
      <p className="text-sm text-gray-700">
        Message for {q.data.supplierName ?? 'the supplier'} (no customer details, no selling prices):
      </p>
      <pre className="whitespace-pre-wrap rounded-lg border bg-gray-50 p-3 text-sm">{q.data.text}</pre>
      <div className="flex flex-wrap gap-2">
        {q.data.whatsappUrl && (
          <a className="btn-primary min-h-12" href={q.data.whatsappUrl} target="_blank" rel="noopener noreferrer">
            Open WhatsApp
          </a>
        )}
        <button
          type="button"
          className="btn-secondary min-h-12"
          onClick={() => {
            void navigator.clipboard?.writeText(q.data.text).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy message'}
        </button>
      </div>
      {!q.data.whatsappUrl && <p className="text-sm text-amber-900">Add the supplier's phone in Shop settings to open WhatsApp directly.</p>}
    </div>
  );
}

type Move = ReturnType<typeof useOrderAction<Omit<TransitionInput, 'expectedFrom'>>>;

function ConfirmBox({ d, move }: { d: Detail; move: Move }) {
  const [costs, setCosts] = useState<Record<string, string>>(() =>
    Object.fromEntries(d.items.map((i) => [i.id, paiseToInput(i.expectedUnitCostPaise)])),
  );
  const [date, setDate] = useState(d.order.expectedDeliveryDate ?? '');
  const [note, setNote] = useState(d.order.expectedDeliveryNote ?? '');
  const [sameDay, setSameDay] = useState<'CONFIRMED' | 'NOT_POSSIBLE' | ''>('');
  const [problem, setProblem] = useState('');
  const asked = d.order.sameDayState === 'REQUESTED';

  function confirm() {
    const lines = d.items.map((i) => ({ itemId: i.id, confirmedUnitCostPaise: toPaise(costs[i.id] ?? '') }));
    if (lines.some((l) => l.confirmedUnitCostPaise === null)) return setProblem("Enter the supplier's rate for every item (like 175 or 175.50).");
    if (asked && !sameDay) return setProblem('The customer asked for same-day delivery: choose whether it is possible.');
    setProblem('');
    move.mutate({
      to: 'SUPPLIER_CONFIRMED',
      lines: lines as { itemId: string; confirmedUnitCostPaise: number }[],
      delivery: { date: date || null, note: note.trim(), ...(sameDay ? { sameDay } : {}) },
    });
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-gray-700">When the supplier replies, enter their rate per unit:</p>
      {d.items.map((i) => (
        <label key={i.id} className="grid gap-1 text-sm font-medium">
          {i.productName} × {i.quantity} — supplier rate per unit (₹)
          <input
            className="field min-h-12"
            inputMode="decimal"
            value={costs[i.id] ?? ''}
            onChange={(e) => setCosts({ ...costs, [i.id]: e.target.value })}
          />
        </label>
      ))}
      {asked && (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Same-day delivery (customer asked)</legend>
          {(['CONFIRMED', 'NOT_POSSIBLE'] as const).map((v) => (
            <label key={v} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="sameDay" checked={sameDay === v} onChange={() => setSameDay(v)} />
              {v === 'CONFIRMED' ? 'Yes, today' : 'Not possible today'}
            </label>
          ))}
        </fieldset>
      )}
      <label className="grid gap-1 text-sm font-medium">
        Expected delivery date (the customer sees it)
        <input type="date" className="field min-h-12" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Delivery note (optional, the customer sees it)
        <input className="field min-h-12" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Evening, after 5 pm" />
      </label>
      {problem && (
        <p role="alert" className="text-red-700">
          {problem}
        </p>
      )}
      <button type="button" className="btn-primary min-h-12" disabled={move.isPending} onClick={confirm}>
        Supplier confirmed
      </button>
      <SupplierHasNone move={move} />
    </div>
  );
}

function SupplierHasNone({ move }: { move: Move }) {
  const [open, setOpen] = useState(false);
  const [outOfStock, setOutOfStock] = useState(true);
  if (!open)
    return (
      <button type="button" className="btn-secondary min-h-12" onClick={() => setOpen(true)}>
        Supplier doesn't have it…
      </button>
    );
  return (
    <div className="grid gap-2 rounded-xl border-2 border-red-200 p-3">
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={outOfStock} onChange={(e) => setOutOfStock(e.target.checked)} />
        Also mark these products out of stock, so nobody else can order them
      </label>
      <ReasonForm
        label="Message for the customer"
        initial="Sorry, the supplier is out of stock."
        button="Cancel order: supplier has none"
        danger
        busy={move.isPending}
        onSubmit={(note) => move.mutate({ to: 'CANCELLED', note, markOutOfStock: outOfStock })}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

function CodBox({ d }: { d: Detail }) {
  const o = d.order;
  const cod = useOrderAction(o.id, (input: { amountPaise: number; mismatchNote: string }) => recordShopCod(o.id, input));
  const [amount, setAmount] = useState(paiseToInput(o.totalPaise));
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const paise = toPaise(amount);
  const different = paise !== null && paise !== o.totalPaise;

  function save() {
    if (paise === null || paise <= 0) return setProblem('Enter the amount you collected, like 440.');
    if (different && note.trim().length < 3) return setProblem('The amount is different from the order total — write a short note about why.');
    setProblem('');
    cod.mutate({ amountPaise: paise, mismatchNote: different ? note.trim() : '' });
  }

  return (
    <div className="grid gap-2 rounded-xl border-2 border-green-300 bg-green-50 p-3">
      <label className="grid gap-1 text-sm font-medium">
        Cash collected (₹) — order total {rupees(o.totalPaise)}
        <input className="field min-h-12" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {different && (
        <label className="grid gap-1 text-sm font-medium">
          Why is it different? (only you see this)
          <input className="field min-h-12" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      {(problem || cod.isError) && (
        <p role="alert" className="text-red-700">
          {problem || errText(cod.error)}
        </p>
      )}
      <button type="button" className="btn-primary min-h-12" disabled={cod.isPending} onClick={save}>
        Delivered — cash collected
      </button>
    </div>
  );
}

function DeliveryBox({ d }: { d: Detail }) {
  const o = d.order;
  const save = useOrderAction(o.id, (input: { date: string | null; note: string; sameDay: 'CONFIRMED' | 'NOT_POSSIBLE' | null }) =>
    setShopDeliveryExpectation(o.id, input),
  );
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(o.expectedDeliveryDate ?? '');
  const [note, setNote] = useState(o.expectedDeliveryNote ?? '');
  if (o.status === 'SUPPLIER_PENDING') return null; // set while confirming
  if (!open)
    return (
      <button type="button" className="btn-secondary min-h-12" onClick={() => setOpen(true)}>
        Change expected delivery…
      </button>
    );
  return (
    <section className="card grid gap-2" aria-label="Expected delivery">
      <label className="grid gap-1 text-sm font-medium">
        Expected delivery date (the customer sees it)
        <input type="date" className="field min-h-12" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Note (the customer sees it)
        <input className="field min-h-12" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {save.isError && (
        <p role="alert" className="text-red-700">
          {errText(save.error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary min-h-12"
          disabled={save.isPending}
          onClick={() => save.mutate({ date: date || null, note: note.trim(), sameDay: null }, { onSuccess: () => setOpen(false) })}
        >
          Save
        </button>
        {o.sameDayState === 'CONFIRMED' && (
          <button
            type="button"
            className="btn-secondary min-h-12"
            disabled={save.isPending}
            onClick={() => save.mutate({ date: date || null, note: note.trim(), sameDay: 'NOT_POSSIBLE' }, { onSuccess: () => setOpen(false) })}
          >
            Same day no longer possible
          </button>
        )}
        <button type="button" className="btn-secondary min-h-12" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </section>
  );
}

function ReasonForm(props: {
  label: string;
  button: string;
  busy: boolean;
  onSubmit: (note: string) => void;
  onCancel?: () => void;
  danger?: boolean;
  initial?: string;
  extra?: string;
  cancelLabel?: string;
}) {
  const [text, setText] = useState(props.initial ?? '');
  const [problem, setProblem] = useState('');
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim().length < 3) return setProblem('Please write a reason (at least 3 characters).');
        setProblem('');
        props.onSubmit(text.trim());
      }}
    >
      <label className="grid gap-1 text-sm font-medium">
        {props.label}
        <textarea className="field min-h-20" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {props.extra && <p className="text-sm text-gray-700">{props.extra}</p>}
      {problem && (
        <p role="alert" className="text-red-700">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={props.busy} className={`min-h-12 ${props.danger ? 'btn-danger' : 'btn-primary'}`}>
          {props.button}
        </button>
        {props.onCancel && (
          <button type="button" className="btn-secondary min-h-12" onClick={props.onCancel}>
            {props.cancelLabel ?? 'Keep the order'}
          </button>
        )}
      </div>
    </form>
  );
}

function CustomerAccessToggle({ customerId, readOnly }: { customerId: string; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 grid gap-2">
      <button type="button" aria-expanded={open} className="btn-secondary min-h-11 justify-self-start" onClick={() => setOpen(!open)}>
        {open ? 'Hide phones & recovery' : 'Phones & recovery…'}
      </button>
      {open && <ShopCustomerAccess customerId={customerId} readOnly={readOnly} />}
    </div>
  );
}

const EXPENSE_KINDS: { id: ExpenseKind; label: string }[] = [
  { id: 'TRAVEL', label: 'Travel / petrol' },
  { id: 'PACKAGING', label: 'Packaging' },
  { id: 'DELIVERY', label: 'Delivery help' },
  { id: 'OTHER', label: 'Other' },
];
const kindLabel = (k: ExpenseKind) => EXPENSE_KINDS.find((x) => x.id === k)?.label ?? k;

// Optional (Q10): costs of this order beyond the supplier's rate. Wrong ones are voided with a reason, never deleted.
function Expenses({ d, readOnly }: { d: Detail; readOnly: boolean }) {
  const o = d.order;
  const add = useOrderAction(o.id, (input: { kind: ExpenseKind; amountPaise: number; note: string }) => addShopExpense(o.id, input));
  const voidIt = useOrderAction(o.id, (input: { id: string; reason: string }) => voidShopExpense(input.id, input.reason));
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ExpenseKind>('TRAVEL');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [voiding, setVoiding] = useState<string | null>(null);
  if (readOnly && d.expenses.length === 0) return null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    const paise = toPaise(amount);
    if (paise === null || paise <= 0) return setProblem('Enter the amount, like 30.');
    setProblem('');
    add.mutate({ kind, amountPaise: paise, note: note.trim() }, { onSuccess: () => { setAmount(''); setNote(''); setOpen(false); } });
  }

  return (
    <section className="card grid gap-2" aria-label="Expenses">
      <h3 className="text-lg font-semibold">Expenses</h3>
      {d.expenses.length === 0 && <p className="text-sm text-gray-700">None recorded. Optional: petrol, packaging and so on.</p>}
      <ul className="grid gap-1 text-sm">
        {d.expenses.map((x) => (
          <li key={x.id} className={x.voidedAt ? 'text-gray-500' : ''}>
            <span className={x.voidedAt ? 'line-through' : 'font-medium'}>
              {kindLabel(x.kind)} {rupees(x.amountPaise)}
            </span>
            {x.note ? ` · ${x.note}` : ''} · {fmtWhen(x.createdAt)}
            {x.voidedAt && <span className="block">Removed: {x.voidReason}</span>}
            {!x.voidedAt && !readOnly && voiding !== x.id && (
              <button type="button" className="ml-2 text-blue-800 underline" onClick={() => setVoiding(x.id)}>
                Remove…
              </button>
            )}
            {voiding === x.id && (
              <ReasonForm
                label="Why remove it? (it stays in the history)"
                button="Remove expense"
                danger
                busy={voidIt.isPending}
                onSubmit={(reason) => voidIt.mutate({ id: x.id, reason }, { onSuccess: () => setVoiding(null) })}
                onCancel={() => setVoiding(null)}
                cancelLabel="Keep it"
              />
            )}
          </li>
        ))}
      </ul>
      {(add.isError || voidIt.isError) && (
        <p role="alert" className="text-red-700">
          {errText(add.error ?? voidIt.error)}
        </p>
      )}
      {!readOnly && !open && (
        <button type="button" className="btn-secondary min-h-12 justify-self-start" onClick={() => setOpen(true)}>
          Add an expense…
        </button>
      )}
      {!readOnly && open && (
        <form className="grid gap-2" onSubmit={save}>
          <label className="grid gap-1 text-sm font-medium">
            What for
            <select className="field min-h-12" value={kind} onChange={(e) => setKind(e.target.value as ExpenseKind)}>
              {EXPENSE_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Amount (₹)
            <input className="field min-h-12" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Note (optional)
            <input className="field min-h-12" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {problem && (
            <p role="alert" className="text-red-700">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary min-h-12" disabled={add.isPending}>
              Save expense
            </button>
            <button type="button" className="btn-secondary min-h-12" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
