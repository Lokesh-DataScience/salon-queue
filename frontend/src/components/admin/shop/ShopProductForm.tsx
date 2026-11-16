// frontend/src/components/admin/shop/ShopProductForm.tsx — create a product, or edit one's details (not stock).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createShopProduct,
  paiseToInput,
  rupees,
  toPaise,
  updateShopProduct,
  type ProductInput,
  type ShopCategory,
  type ShopProduct,
} from '../../../api/shopAdmin';
import { ApiError } from '../../../api/client';

const errText = (e: unknown) => {
  if (e instanceof ApiError && e.fieldErrors) {
    const first = Object.values(e.fieldErrors).flat().find(Boolean);
    if (first) return first;
  }
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
};

interface Props {
  categories: ShopCategory[];
  product?: ShopProduct; // edit mode when set
  onDone: (id: string) => void;
  onCancel: () => void;
}

export default function ShopProductForm({ categories, product, onDone, onCancel }: Props) {
  const qc = useQueryClient();
  const editing = !!product;
  const [f, setF] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    brand: product?.brand ?? '',
    description: product?.description ?? '',
    categoryId: product?.categoryId ?? '',
    mrp: product ? paiseToInput(product.mrpPaise) : '',
    selling: product ? paiseToInput(product.sellingPricePaise) : '',
    cost: product ? paiseToInput(product.wholesaleCostPaise) : '',
    buffer: String(product?.stockBuffer ?? 0),
    maxPerOrder: String(product?.maxPerOrder ?? 5),
    sameDay: product?.sameDayEligible ?? true,
    initialStock: '0',
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  const mrp = toPaise(f.mrp);
  const selling = toPaise(f.selling);
  const cost = toPaise(f.cost);
  const margin = selling !== null && cost !== null ? selling - cost : null;

  const save = useMutation({
    mutationFn: async () => {
      const input: ProductInput = {
        name: f.name.trim(),
        sku: f.sku.trim(),
        brand: f.brand.trim(),
        description: f.description.trim(),
        categoryId: f.categoryId || null,
        mrpPaise: mrp!,
        sellingPricePaise: selling!,
        wholesaleCostPaise: cost!,
        stockBuffer: Number(f.buffer),
        maxPerOrder: Number(f.maxPerOrder),
        sameDayEligible: f.sameDay,
      };
      return editing
        ? updateShopProduct(product!.id, input)
        : createShopProduct({ ...input, initialStock: Number(f.initialStock) });
    },
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ['shopProducts'] });
      qc.setQueryData(['shopProduct', p.id], p);
      onDone(p.id);
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (mrp === null || selling === null || cost === null) return setLocalError('Enter prices in rupees, like 249 or 249.50.');
    if (mrp <= 0 || selling <= 0) return setLocalError('MRP and selling price must be more than ₹0.');
    if (selling >= mrp) return setLocalError('Selling price must be lower than MRP.');
    if (!/^\d+$/.test(f.buffer) || !/^\d+$/.test(f.maxPerOrder) || (!editing && !/^\d+$/.test(f.initialStock))) {
      return setLocalError('Stock numbers must be whole numbers.');
    }
    save.mutate();
  }

  const num = 'field';
  return (
    <form className="card grid gap-3" aria-label={editing ? 'Edit product' : 'Add product'} onSubmit={submit} noValidate>
      <h3 className="text-base font-semibold">{editing ? 'Edit product' : 'Add product'}</h3>
      {!editing && <p className="text-sm text-gray-600">New products start hidden. Show them once the photo and stock are ready.</p>}
      <div>
        <label htmlFor="p-name" className="mb-1 block text-sm font-medium">Name (with size, e.g. "Beard Oil 50 ml")</label>
        <input id="p-name" className="field" required maxLength={120} value={f.name} onChange={set('name')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="p-sku" className="mb-1 block text-sm font-medium">SKU (supplier's code)</label>
          <input id="p-sku" className="field" required maxLength={40} value={f.sku} onChange={set('sku')} autoCapitalize="characters" />
        </div>
        <div>
          <label htmlFor="p-brand" className="mb-1 block text-sm font-medium">Brand</label>
          <input id="p-brand" className="field" maxLength={60} value={f.brand} onChange={set('brand')} />
        </div>
      </div>
      <div>
        <label htmlFor="p-cat" className="mb-1 block text-sm font-medium">Category</label>
        <select id="p-cat" className="field" value={f.categoryId} onChange={set('categoryId')}>
          <option value="">No category</option>
          {categories.filter((c) => c.isActive || c.id === f.categoryId).map((c) => (
            <option key={c.id} value={c.id}>{c.nameEn}{c.nameHi ? ` · ${c.nameHi}` : ''}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="p-desc" className="mb-1 block text-sm font-medium">Description (optional)</label>
        <textarea id="p-desc" className="field min-h-20" maxLength={2000} value={f.description} onChange={set('description')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="p-mrp" className="mb-1 block text-sm font-medium">MRP (₹)</label>
          <input id="p-mrp" className={num} inputMode="decimal" required value={f.mrp} onChange={set('mrp')} />
        </div>
        <div>
          <label htmlFor="p-sell" className="mb-1 block text-sm font-medium">Selling price (₹)</label>
          <input id="p-sell" className={num} inputMode="decimal" required value={f.selling} onChange={set('selling')} />
        </div>
        <div>
          <label htmlFor="p-cost" className="mb-1 block text-sm font-medium">Wholesale cost (₹)</label>
          <input id="p-cost" className={num} inputMode="decimal" required value={f.cost} onChange={set('cost')} />
        </div>
      </div>
      {margin !== null && (
        <p className={`text-sm ${margin <= 0 ? 'font-semibold text-red-700' : 'text-gray-700'}`}>
          Margin per unit: {rupees(margin)}
          {margin <= 0 ? ' — you would make no profit on this product.' : ''}
        </p>
      )}
      <div className={`grid gap-3 ${editing ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
        {!editing && (
          <div>
            <label htmlFor="p-stock" className="mb-1 block text-sm font-medium">Stock now (units)</label>
            <input id="p-stock" className={num} inputMode="numeric" value={f.initialStock} onChange={set('initialStock')} />
          </div>
        )}
        <div>
          <label htmlFor="p-buffer" className="mb-1 block text-sm font-medium">Safety buffer (units not sold)</label>
          <input id="p-buffer" className={num} inputMode="numeric" value={f.buffer} onChange={set('buffer')} />
        </div>
        <div>
          <label htmlFor="p-max" className="mb-1 block text-sm font-medium">Max per order (1–20)</label>
          <input id="p-max" className={num} inputMode="numeric" value={f.maxPerOrder} onChange={set('maxPerOrder')} />
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" className="h-5 w-5" checked={f.sameDay} onChange={set('sameDay')} />
        <span>Can be delivered the same day</span>
      </label>
      {(localError || save.isError) && (
        <p role="alert" className="text-sm text-red-700">{localError ?? errText(save.error)}</p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-12 flex-1" disabled={save.isPending}>
          {save.isPending ? 'Saving...' : editing ? 'Save changes' : 'Add product'}
        </button>
        <button type="button" className="btn-secondary min-h-12 px-4" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
