// frontend/src/components/shop/ProductCard.tsx — one product in the customer shop (grid or strip).
// C2: browse only. Tapping a product opens its details from C3.
import type { ShopCatalogProduct } from '../../api/shop';
import { rupees } from '../../lib/money';
import { useT } from '../../lib/i18n';

const TEXT = {
  hi: { off: (n: number) => `${n}% छूट`, mrp: 'MRP', low: 'कुछ ही बचे हैं', out: 'अभी उपलब्ध नहीं', noPhoto: 'फ़ोटो नहीं' },
  en: { off: (n: number) => `${n}% off`, mrp: 'MRP', low: 'Only a few left', out: 'Out of stock', noPhoto: 'No photo' },
};

export default function ProductCard({ p, compact = false }: { p: ShopCatalogProduct; compact?: boolean }) {
  const t = useT(TEXT);
  const out = p.availability === 'OUT_OF_STOCK';
  return (
    <article className={`flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white ${out ? 'opacity-70' : ''}`}>
      <div className="relative aspect-square w-full bg-gray-50">
        {p.image ? (
          <img src={p.image.url} alt={p.image.alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-sm text-gray-500">{t.noPhoto}</span>
        )}
        {p.discountPercent > 0 && !out && (
          <span className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-white">
            {t.off(p.discountPercent)}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        {p.brand && !compact && <p className="truncate text-xs font-semibold uppercase tracking-wide text-gray-600">{p.brand}</p>}
        <h3 className={`font-semibold text-ink ${compact ? 'line-clamp-2 text-sm' : 'line-clamp-2 text-base'}`}>{p.name}</h3>
        <p className="mt-auto pt-1">
          <span className="text-lg font-bold text-ink">{rupees(p.sellingPricePaise)}</span>{' '}
          <span className="text-sm text-gray-600">
            {t.mrp} <s>{rupees(p.mrpPaise)}</s>
          </span>
        </p>
        {p.availability !== 'IN_STOCK' && (
          <p className={`text-sm font-semibold ${out ? 'text-red-800' : 'text-amber-900'}`}>{out ? t.out : t.low}</p>
        )}
      </div>
    </article>
  );
}
