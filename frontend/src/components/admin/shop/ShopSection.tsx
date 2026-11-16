// frontend/src/components/admin/shop/ShopSection.tsx — the Admin "Shop" tab (Commerce Phase 1, C1).
// Founder: manages products, stock, photos and settings. Cofounder: sees everything (incl. cost and margin), changes nothing.
// Hiding buttons is cosmetic: the server refuses every Cofounder change.
import { useSearchParams } from 'react-router-dom';
import { SHOP_READ_ONLY_NOTE, useShopReadOnly } from './useShopReadOnly';
import ShopProducts from './ShopProducts';
import ShopStockCheck from './ShopStockCheck';
import ShopSettingsPanel from './ShopSettingsPanel';

const VIEWS = [
  { id: 'products', label: 'Products' },
  { id: 'stock', label: 'Stock check' },
  { id: 'settings', label: 'Settings' },
] as const;
type View = (typeof VIEWS)[number]['id'];

export default function ShopSection() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view: View = VIEWS.some((v) => v.id === requested) ? (requested as View) : 'products';
  const readOnly = useShopReadOnly();

  function choose(v: View) {
    const next = new URLSearchParams(params);
    next.set('view', v);
    next.delete('product');
    setParams(next, { replace: true });
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-gray-600">
        The shop is not visible to customers yet. It opens in a later step, once orders work end to end.
      </p>
      {readOnly && (
        <p role="note" className="rounded-xl border-2 border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">
          {SHOP_READ_ONLY_NOTE}
        </p>
      )}
      <div role="group" aria-label="Shop view" className="grid grid-cols-3 gap-2">
        {VIEWS.map((v) => {
          const on = v.id === view;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => choose(v.id)}
              className={`min-h-12 rounded-xl px-3 text-base ${
                on ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      {view === 'products' && <ShopProducts readOnly={readOnly} />}
      {view === 'stock' && <ShopStockCheck readOnly={readOnly} />}
      {view === 'settings' && <ShopSettingsPanel readOnly={readOnly} />}
    </div>
  );
}
