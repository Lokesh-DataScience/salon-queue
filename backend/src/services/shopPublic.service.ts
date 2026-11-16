// backend/src/services/shopPublic.service.ts — the customer-facing catalog (Commerce Phase 1, C2).
// Public fields only: never wholesale cost, margin, SKU, supplier or exact stock numbers.
// Everything here is behind the shop_enabled flag; when it is off the routes answer 404.
import { supabase } from '../config/supabase';
import { listFlags } from './flags.service';
import { AppError } from '../middleware/errorHandler';
import { publicImageUrl, shopDbError } from './shopAdmin.service';

export const SHOP_FLAG = 'shop_enabled';
export const LOW_STOCK_AT = 3; // "Only a few left" at 3 or fewer sellable units

export async function shopFlag(): Promise<{ enabled: boolean; stripAudience: 'internal' | 'all' }> {
  const flag = (await listFlags()).find((f) => f.key === SHOP_FLAG);
  return { enabled: !!flag?.enabled, stripAudience: flag?.value?.trim() === 'all' ? 'all' : 'internal' };
}

// Should the Shop strip show on a ticket of this salon? (Q12: waiting and completed tickets alike.)
export async function shopStatus(salonId?: string) {
  const { enabled, stripAudience } = await shopFlag();
  if (!enabled) return { enabled: false, showStrip: false };
  if (!salonId) return { enabled: true, showStrip: false };
  if (stripAudience === 'all') return { enabled: true, showStrip: true };
  const { data, error } = await supabase.from('salons').select('is_internal').eq('id', salonId).maybeSingle();
  if (error) throw error;
  return { enabled: true, showStrip: !!data?.is_internal };
}

export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

interface Row {
  id: string;
  name: string;
  brand: string;
  category_id: string | null;
  mrp_paise: number;
  selling_price_paise: number;
  stock_on_hand: number;
  stock_reserved: number;
  stock_buffer: number;
  product_images: { storage_path: string; sort_order: number; alt: string }[] | null;
}

function toPublic(r: Row) {
  const sellable = r.stock_on_hand - r.stock_reserved - r.stock_buffer;
  const availability: Availability = sellable <= 0 ? 'OUT_OF_STOCK' : sellable <= LOW_STOCK_AT ? 'LOW_STOCK' : 'IN_STOCK';
  const first = [...(r.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    categoryId: r.category_id,
    mrpPaise: r.mrp_paise,
    sellingPricePaise: r.selling_price_paise,
    discountPercent: Math.floor(((r.mrp_paise - r.selling_price_paise) * 100) / r.mrp_paise),
    availability,
    image: first ? { url: publicImageUrl(first.storage_path), alt: first.alt || r.name } : null,
  };
}
export type PublicProduct = ReturnType<typeof toPublic>;

export async function listPublicProducts(categoryId?: string) {
  // Stock columns are read only to compute the label; they never leave this function.
  let q = supabase
    .from('products')
    .select('id, name, brand, category_id, mrp_paise, selling_price_paise, stock_on_hand, stock_reserved, stock_buffer, product_images (storage_path, sort_order, alt)')
    .eq('is_visible', true)
    .is('deleted_at', null)
    .order('name')
    .limit(300);
  if (categoryId) q = q.eq('category_id', categoryId);
  const { data, error } = await q;
  if (error) throw error;
  const products = ((data ?? []) as unknown as Row[]).map(toPublic);
  // In-stock first (stable, so each group stays in name order).
  return products.sort((a, b) => Number(a.availability === 'OUT_OF_STOCK') - Number(b.availability === 'OUT_OF_STOCK'));
}

// Active categories that have at least one visible product.
export async function listPublicCategories() {
  const [{ data: cats, error: e1 }, { data: used, error: e2 }] = await Promise.all([
    supabase.from('product_categories').select('id, slug, name_en, name_hi, sort_order').eq('is_active', true).order('sort_order'),
    supabase.from('products').select('category_id').eq('is_visible', true).is('deleted_at', null).not('category_id', 'is', null),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const inUse = new Set((used ?? []).map((r) => r.category_id as string));
  return (cats ?? [])
    .filter((c) => inUse.has(c.id as string))
    .map((c) => ({ id: c.id as string, slug: c.slug as string, nameEn: c.name_en as string, nameHi: c.name_hi as string }));
}

// ── Product details (C3) ─────────────────────────────────────────────────

export async function getPublicProduct(productId: string) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, description, category_id, mrp_paise, selling_price_paise, stock_on_hand, stock_reserved, stock_buffer, max_per_order, same_day_eligible, product_images (storage_path, sort_order, alt)')
    .eq('id', productId)
    .eq('is_visible', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('This product is not available.', 404);
  const r = data as unknown as Row & { description: string; max_per_order: number; same_day_eligible: boolean };
  const images = [...(r.product_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({ url: publicImageUrl(i.storage_path), alt: i.alt || r.name }));
  return {
    ...toPublic(r),
    description: r.description,
    images,
    maxPerOrder: r.max_per_order,
    sameDayEligible: r.same_day_eligible,
  };
}

// ── Server quote (C3, §8.1). Reads only; reserves nothing. ────────────────

export type LineProblem = 'UNAVAILABLE' | 'NOT_ENOUGH_STOCK' | 'OVER_LIMIT';

interface QuoteLineRow {
  product_id: string;
  qty: number;
  problem: LineProblem | null;
  max_qty: number | null;
  unit_price_paise: number | null;
  mrp_paise: number | null;
  line_total_paise: number | null;
}
interface QuoteRow {
  lines: QuoteLineRow[];
  subtotal_paise: number;
  delivery_fee_paise: number;
  total_paise: number;
  order_problems: string[];
  cod_max_order_paise: number | null;
  ok: boolean;
  same_day_requestable: boolean;
}

export async function quoteCart(items: { productId: string; qty: number }[]) {
  const { data, error } = await supabase.rpc('price_cart', {
    p_items: items.map((i) => ({ product_id: i.productId, qty: i.qty })),
  });
  if (error) {
    if (error.message === 'SHOP_INVALID_CART') throw new AppError('Your cart could not be read. Please try again.', 400);
    shopDbError(error);
  }
  const q = data as QuoteRow;

  // Names and photos for the cart screen (public fields only, same as the catalog).
  const ids = q.lines.map((l) => l.product_id);
  const { data: rows, error: e2 } = await supabase
    .from('products')
    .select('id, name, brand, is_visible, deleted_at, product_images (storage_path, sort_order, alt)')
    .in('id', ids);
  if (e2) throw e2;
  const info = new Map(
    ((rows ?? []) as unknown as { id: string; name: string; brand: string; is_visible: boolean; deleted_at: string | null; product_images: Row['product_images'] }[])
      .filter((r) => r.is_visible && !r.deleted_at)
      .map((r) => {
        const first = [...(r.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
        return [r.id, { name: r.name, brand: r.brand, image: first ? { url: publicImageUrl(first.storage_path), alt: first.alt || r.name } : null }];
      }),
  );

  return {
    lines: q.lines.map((l) => ({
      productId: l.product_id,
      qty: l.qty,
      problem: l.problem,
      maxQty: l.max_qty,
      unitPricePaise: l.unit_price_paise,
      mrpPaise: l.mrp_paise,
      lineTotalPaise: l.line_total_paise,
      name: info.get(l.product_id)?.name ?? null, // null for products that are no longer sold
      brand: info.get(l.product_id)?.brand ?? null,
      image: info.get(l.product_id)?.image ?? null,
    })),
    subtotalPaise: q.subtotal_paise,
    deliveryFeePaise: q.delivery_fee_paise,
    totalPaise: q.total_paise,
    orderProblems: q.order_problems,
    codMaxOrderPaise: q.cod_max_order_paise,
    ok: q.ok,
    sameDayRequestable: q.same_day_requestable,
  };
}
