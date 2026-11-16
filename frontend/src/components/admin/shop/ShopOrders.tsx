// frontend/src/components/admin/shop/ShopOrders.tsx — the founder's order list (Commerce C5a). Opens ?order=<id>.
// Refreshes every 30 s while open, so a new order shows up without a reload (the push brings you here).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { fetchShopOrders, rupees, type AdminOrderStatus, type OrderListFilter } from '../../../api/shopAdmin';
import ShopOrderDetail from './ShopOrderDetail';
import { ADMIN_STATUS, ADMIN_STATUS_TONE, fmtWhen } from './orderLabels';

const FILTERS: { id: OrderListFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'PLACED', label: 'New' },
  { id: 'DELIVERED', label: 'Delivered' },
  { id: 'CANCELLED', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

export default function ShopOrders({ readOnly }: { readOnly: boolean }) {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<OrderListFilter>('open');
  const [search, setSearch] = useState('');
  const open = params.get('order');

  const list = useQuery({
    queryKey: ['shopOrders', filter, search.replace(/\D/g, '')],
    queryFn: () => fetchShopOrders({ status: search.replace(/\D/g, '') ? 'all' : filter, search: search.replace(/\D/g, '') || undefined }),
    refetchInterval: 30_000,
    enabled: !open,
  });

  function go(order: string | null) {
    const next = new URLSearchParams(params);
    if (order) next.set('order', order);
    else next.delete('order');
    setParams(next);
  }

  if (open) return <ShopOrderDetail orderId={open} readOnly={readOnly} onBack={() => go(null)} />;

  const counts = list.data?.counts ?? {};
  const newCount = counts.PLACED ?? 0;

  return (
    <div className="grid gap-3">
      {newCount > 0 && (
        <p role="status" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 font-semibold text-amber-900">
          {newCount === 1 ? '1 new order is waiting for you.' : `${newCount} new orders are waiting for you.`}
        </p>
      )}
      <label className="grid gap-1 text-sm font-medium">
        Find an order number
        <input
          className="field min-h-12"
          inputMode="numeric"
          placeholder="e.g. 1042"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div role="group" aria-label="Which orders" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = f.id === filter;
          const n = f.id === 'open' ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : f.id === 'PLACED' ? newCount : null;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.id)}
              className={`min-h-11 rounded-full px-4 text-sm ${on ? 'border-4 border-ink bg-brand font-bold' : 'border-2 border-gray-300 bg-white'}`}
            >
              {f.label}
              {n ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      {list.isPending && <p className="text-gray-600">Loading orders…</p>}
      {list.isError && (
        <p role="alert" className="text-red-700">
          Couldn't load orders. {(list.error as Error).message}
        </p>
      )}
      {list.data && list.data.orders.length === 0 && <p className="text-gray-600">No orders here.</p>}
      {list.data && list.data.orders.length > 0 && (
        <ul className="divide-y rounded-xl border-2 border-gray-200 bg-white">
          {list.data.orders.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => go(o.id)} className="grid w-full gap-1 p-3 text-left hover:bg-brand-soft">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{o.orderNumber}</span>
                  <StatusPill status={o.status} />
                  {(o.sameDayState === 'REQUESTED' || o.sameDayState === 'CONFIRMED') && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-900">
                      {o.sameDayState === 'REQUESTED' ? 'Same day asked' : 'Same day'}
                    </span>
                  )}
                </span>
                <span className="text-sm text-gray-700">
                  {o.customerName} · {o.pincode || 'no pincode'} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'} · {rupees(o.totalPaise)} COD
                </span>
                <span className="text-xs text-gray-600">
                  Placed {fmtWhen(o.createdAt)}
                  {o.expectedDeliveryDate ? ` · Delivery ${o.expectedDeliveryDate}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatusPill({ status }: { status: AdminOrderStatus }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${ADMIN_STATUS_TONE[status]}`}>{ADMIN_STATUS[status]}</span>;
}
