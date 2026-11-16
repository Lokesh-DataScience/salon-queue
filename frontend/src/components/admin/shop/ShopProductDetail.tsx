// frontend/src/components/admin/shop/ShopProductDetail.tsx — one product: details, show/hide, stock changes, photos, history.
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  changeShopStock,
  deleteShopImage,
  deleteShopProduct,
  fetchShopMovements,
  fetchShopProduct,
  rupees,
  setShopAvailability,
  uploadShopImage,
  type ShopCategory,
  type ShopProduct,
  type StockChangeType,
} from '../../../api/shopAdmin';
import { ApiError } from '../../../api/client';
import ShopProductForm from './ShopProductForm';

const errText = (e: unknown) => {
  if (e instanceof ApiError && e.fieldErrors) {
    const first = Object.values(e.fieldErrors).flat().find(Boolean);
    if (first) return first;
  }
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
};
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const MOVEMENT_LABEL: Record<string, string> = {
  INITIAL_STOCK: 'Initial stock',
  STOCK_COUNT: 'Stock count',
  MANUAL_ADJUSTMENT: 'Adjustment',
  DAMAGED_STOCK: 'Damaged',
};

function useProductCache() {
  const qc = useQueryClient();
  return async (p: ShopProduct) => {
    qc.setQueryData(['shopProduct', p.id], p);
    await qc.invalidateQueries({ queryKey: ['shopProducts'] });
    await qc.invalidateQueries({ queryKey: ['shopMovements', p.id] });
  };
}

function StockForm({ p }: { p: ShopProduct }) {
  const refresh = useProductCache();
  const [type, setType] = useState<StockChangeType>('STOCK_COUNT');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => changeShopStock(p.id, { type, qty: Number(qty), expectedOnHand: p.stockOnHand, reason: reason.trim() }),
    onSuccess: async (next) => {
      setQty('');
      setReason('');
      await refresh(next);
    },
  });
  const qtyLabel =
    type === 'STOCK_COUNT' ? 'Counted units in stock' : type === 'DAMAGED_STOCK' ? 'Damaged units' : 'Change (+ added, − removed)';

  return (
    <form
      className="card grid gap-3"
      aria-label="Change stock"
      onSubmit={(e) => {
        e.preventDefault();
        setLocal(null);
        const ok = type === 'MANUAL_ADJUSTMENT' ? /^-?\d+$/.test(qty.trim()) : /^\d+$/.test(qty.trim());
        if (!ok) return setLocal('Enter a whole number.');
        m.mutate();
      }}
    >
      <h3 className="text-base font-semibold">Stock</h3>
      <p className="text-sm text-gray-700">
        In stock <strong>{p.stockOnHand}</strong> · Reserved by orders <strong>{p.stockReserved}</strong> · Safety buffer{' '}
        <strong>{p.stockBuffer}</strong> · Customers can buy <strong>{p.sellable}</strong>
      </p>
      <p className="text-xs text-gray-600">
        Last checked: {p.lastStockCheckAt ? fmt(p.lastStockCheckAt) : 'never'}
      </p>
      <div>
        <label htmlFor="s-type" className="mb-1 block text-sm font-medium">What happened</label>
        <select id="s-type" className="field" value={type} onChange={(e) => setType(e.target.value as StockChangeType)}>
          <option value="STOCK_COUNT">I counted the stock</option>
          <option value="MANUAL_ADJUSTMENT">Add or remove units</option>
          <option value="DAMAGED_STOCK">Units are damaged</option>
        </select>
      </div>
      <div>
        <label htmlFor="s-qty" className="mb-1 block text-sm font-medium">{qtyLabel}</label>
        <input id="s-qty" className="field" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      {type !== 'STOCK_COUNT' && (
        <div>
          <label htmlFor="s-reason" className="mb-1 block text-sm font-medium">Reason</label>
          <input id="s-reason" className="field" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {(local || m.isError) && <p role="alert" className="text-sm text-red-700">{local ?? errText(m.error)}</p>}
      <button type="submit" className="btn-primary min-h-12" disabled={m.isPending}>
        {m.isPending ? 'Saving...' : 'Save stock change'}
      </button>
    </form>
  );
}

function Photos({ p, readOnly }: { p: ShopProduct; readOnly: boolean }) {
  const refresh = useProductCache();
  const input = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const up = useMutation({ mutationFn: (file: File) => uploadShopImage(p.id, file, p.name.slice(0, 120)), onSuccess: refresh });
  const del = useMutation({ mutationFn: (imageId: string) => deleteShopImage(p.id, imageId), onSuccess: refresh });

  return (
    <section className="card grid gap-3" aria-label="Photos">
      <h3 className="text-base font-semibold">Photos ({p.images.length}/6)</h3>
      {p.images.length === 0 && <p className="text-sm text-gray-600">No photos yet. Add at least one before showing the product.</p>}
      <ul className="grid grid-cols-3 gap-2">
        {p.images.map((img, i) => (
          <li key={img.id} className="grid gap-1">
            <img src={img.url} alt={img.alt || `${p.name} photo ${i + 1}`} className="aspect-square w-full rounded-lg border object-cover" />
            {!readOnly && (
              <button type="button" className="btn-secondary min-h-11 text-sm" disabled={del.isPending}
                onClick={() => del.mutate(img.id)} aria-label={`Delete photo ${i + 1}`}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && p.images.length < 6 && (
        <>
          <input
            ref={input}
            id="p-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              setLocal(null);
              if (!file) return;
              if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setLocal('Only JPG, PNG or WebP photos.');
              if (file.size > 2 * 1024 * 1024) return setLocal('Photo is too large (max 2 MB).');
              up.mutate(file);
            }}
          />
          <button type="button" className="btn-secondary min-h-12" disabled={up.isPending} onClick={() => input.current?.click()}>
            {up.isPending ? 'Uploading...' : '+ Add photo (max 2 MB)'}
          </button>
        </>
      )}
      {(local || up.isError || del.isError) && (
        <p role="alert" className="text-sm text-red-700">{local ?? errText(up.error ?? del.error)}</p>
      )}
    </section>
  );
}

function History({ productId }: { productId: string }) {
  const q = useQuery({ queryKey: ['shopMovements', productId], queryFn: () => fetchShopMovements(productId) });
  return (
    <section className="card" aria-label="Stock history">
      <h3 className="mb-2 text-base font-semibold">Stock history</h3>
      {q.isLoading && <p role="status" className="text-gray-600">Loading...</p>}
      {q.isError && <p role="alert" className="text-red-600">Couldn't load history.</p>}
      {q.data && q.data.length === 0 && <p className="text-gray-600">No stock changes yet.</p>}
      {q.data && q.data.length > 0 && (
        <ul className="divide-y text-sm">
          {q.data.map((m) => (
            <li key={m.id} className="py-2">
              <span className="font-semibold">{MOVEMENT_LABEL[m.type] ?? m.type}</span>{' '}
              <span className={m.qtyChange < 0 ? 'text-red-700' : 'text-green-800'}>
                {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
              </span>{' '}
              ({m.onHandBefore} → {m.onHandAfter})
              <span className="block text-xs text-gray-600">
                {fmt(m.createdAt)}
                {m.actorName ? ` · ${m.actorName}` : ''}
                {m.reason ? ` · ${m.reason}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface Props {
  productId: string;
  readOnly: boolean;
  categories: ShopCategory[];
  onBack: () => void;
}

export default function ShopProductDetail({ productId, readOnly, categories, onBack }: Props) {
  const refresh = useProductCache();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const q = useQuery({ queryKey: ['shopProduct', productId], queryFn: () => fetchShopProduct(productId) });
  const avail = useMutation({ mutationFn: (v: boolean) => setShopAvailability(productId, v), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => deleteShopProduct(productId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['shopProducts'] });
      onBack();
    },
  });

  const back = (
    <button type="button" onClick={onBack} className="justify-self-start text-sm font-semibold text-gray-700 underline">
      ‹ All products
    </button>
  );
  if (q.isLoading) return <div className="grid gap-3">{back}<p role="status" className="text-gray-600">Loading...</p></div>;
  if (q.isError || !q.data) {
    return <div className="grid gap-3">{back}<p role="alert" className="text-red-600">Couldn't load this product.</p></div>;
  }
  const p = q.data;
  const category = categories.find((c) => c.id === p.categoryId);

  if (editing) {
    return (
      <div className="grid gap-3">
        {back}
        <ShopProductForm categories={categories} product={p} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {back}
      <section className="card grid gap-2" aria-label="Product">
        <h3 className="text-lg font-semibold">{p.name}</h3>
        {p.deletedAt && <p role="note" className="text-sm font-semibold text-red-700">Deleted {fmt(p.deletedAt)} (history kept).</p>}
        <p className="text-sm text-gray-700">
          SKU {p.sku}
          {p.brand ? ` · ${p.brand}` : ''}
          {category ? ` · ${category.nameEn}` : ''}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="text-gray-600">MRP</dt><dd className="font-semibold">{rupees(p.mrpPaise)}</dd></div>
          <div><dt className="text-gray-600">Selling price</dt><dd className="font-semibold">{rupees(p.sellingPricePaise)}</dd></div>
          <div><dt className="text-gray-600">Wholesale cost</dt><dd className="font-semibold">{rupees(p.wholesaleCostPaise)}</dd></div>
          <div>
            <dt className="text-gray-600">Margin</dt>
            <dd className={`font-semibold ${p.marginWarning ? 'text-red-700' : ''}`}>{rupees(p.marginPaise)}</dd>
          </div>
        </dl>
        {p.marginWarning && (
          <p role="note" className="text-sm font-semibold text-red-700">
            Selling price is not above the wholesale cost: this product makes no profit.
          </p>
        )}
        <p className="text-sm text-gray-700">
          Max {p.maxPerOrder} per order · {p.sameDayEligible ? 'Same-day OK' : 'Not same-day'} ·{' '}
          {p.isVisible ? 'Shown to customers (when the shop opens)' : p.isActive ? 'Hidden' : 'Switched off'}
        </p>
        {p.description && <p className="whitespace-pre-line text-sm text-gray-700">{p.description}</p>}
        {!readOnly && !p.deletedAt && (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <button type="button" className="btn-primary min-h-12" disabled={avail.isPending}
              onClick={() => avail.mutate(!p.isVisible)}>
              {p.isVisible ? 'Hide (mark unavailable)' : 'Show to customers'}
            </button>
            <button type="button" className="btn-secondary min-h-12" onClick={() => setEditing(true)}>Edit details</button>
            {confirmDelete ? (
              <button type="button" className="btn-primary min-h-12 bg-red-700" disabled={remove.isPending}
                onClick={() => remove.mutate()}>
                {remove.isPending ? 'Deleting...' : 'Yes, delete product'}
              </button>
            ) : (
              <button type="button" className="btn-secondary min-h-12" onClick={() => setConfirmDelete(true)}>Delete</button>
            )}
          </div>
        )}
        {(avail.isError || remove.isError) && (
          <p role="alert" className="text-sm text-red-700">{errText(avail.error ?? remove.error)}</p>
        )}
      </section>
      <Photos p={p} readOnly={readOnly || !!p.deletedAt} />
      {!readOnly && !p.deletedAt && <StockForm p={p} />}
      {(readOnly || p.deletedAt) && (
        <section className="card text-sm text-gray-700" aria-label="Stock">
          In stock {p.stockOnHand} · Reserved {p.stockReserved} · Buffer {p.stockBuffer} · Can sell {p.sellable}
        </section>
      )}
      <History productId={p.id} />
    </div>
  );
}
