// frontend/src/components/admin/shop/ShopProducts.tsx — product list; opens a product (?product=<id>) or the new-product form (?product=new).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { fetchShopCategories, fetchShopProducts, rupees, type ShopProduct } from '../../../api/shopAdmin';
import ShopProductForm from './ShopProductForm';
import ShopProductDetail from './ShopProductDetail';

function StockBadge({ p }: { p: ShopProduct }) {
  if (p.sellable <= 0) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Out of stock</span>;
  if (p.stockBuffer > 0 && p.sellable <= p.stockBuffer)
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Low stock</span>;
  return null;
}

function ProductRow({ p, onOpen }: { p: ShopProduct; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 py-3 text-left hover:bg-brand-soft">
        {p.images[0] ? (
          <img src={p.images[0].url} alt="" className="h-14 w-14 flex-none rounded-lg border object-cover" />
        ) : (
          <span aria-hidden="true" className="flex h-14 w-14 flex-none items-center justify-center rounded-lg border bg-gray-50 text-xs text-gray-500">
            No photo
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{p.name}</span>
            {!p.isVisible && <span className="rounded-full border border-gray-400 px-2 py-0.5 text-xs text-gray-700">Hidden</span>}
            {!p.isActive && <span className="rounded-full border border-gray-400 px-2 py-0.5 text-xs text-gray-700">Off</span>}
            <StockBadge p={p} />
            {p.marginWarning && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">No margin</span>
            )}
          </span>
          <span className="block text-sm text-gray-700">
            {p.sku} · Sell {rupees(p.sellingPricePaise)} (MRP {rupees(p.mrpPaise)}) · Cost {rupees(p.wholesaleCostPaise)} · Margin{' '}
            {rupees(p.marginPaise)}
          </span>
          <span className="block text-sm text-gray-600">
            In stock {p.stockOnHand} · Reserved {p.stockReserved} · Can sell {p.sellable}
          </span>
        </span>
      </button>
    </li>
  );
}

export default function ShopProducts({ readOnly }: { readOnly: boolean }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const open = params.get('product');

  const categories = useQuery({ queryKey: ['shopCategories'], queryFn: fetchShopCategories });
  const products = useQuery({
    queryKey: ['shopProducts', search.trim(), categoryId],
    queryFn: () => fetchShopProducts({ search: search.trim() || undefined, categoryId: categoryId || undefined }),
  });

  function go(product: string | null) {
    const next = new URLSearchParams(params);
    if (product) next.set('product', product);
    else next.delete('product');
    setParams(next, { replace: false });
  }

  if (open === 'new' && !readOnly) {
    return <ShopProductForm categories={categories.data ?? []} onDone={(id) => go(id)} onCancel={() => go(null)} />;
  }
  if (open && open !== 'new') {
    return <ShopProductDetail productId={open} readOnly={readOnly} categories={categories.data ?? []} onBack={() => go(null)} />;
  }

  return (
    <div className="grid gap-3">
      {!readOnly && (
        <button type="button" className="btn-primary min-h-12" onClick={() => go('new')}>
          + Add product
        </button>
      )}
      <div className="card grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="shop-search" className="mb-1 block text-sm font-medium">Search</label>
          <input id="shop-search" className="field" placeholder="Name, SKU or brand" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label htmlFor="shop-cat" className="mb-1 block text-sm font-medium">Category</label>
          <select id="shop-cat" className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.nameEn}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="card">
        {products.isLoading && <p role="status" className="text-gray-600">Loading...</p>}
        {products.isError && <p role="alert" className="text-red-600">Couldn't load products. Please try again.</p>}
        {products.data && products.data.length === 0 && (
          <p className="text-gray-600">{search || categoryId ? 'No products match.' : 'No products yet.'}</p>
        )}
        {products.data && products.data.length > 0 && (
          <ul className="divide-y" aria-label="Products">
            {products.data.map((p) => (
              <ProductRow key={p.id} p={p} onOpen={() => go(p.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
