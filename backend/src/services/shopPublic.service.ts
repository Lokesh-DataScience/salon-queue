// backend/src/services/shopPublic.service.ts — the customer-facing catalog (Commerce Phase 1, C2).
// Public fields only: never wholesale cost, margin, SKU, supplier or exact stock numbers.
// Everything here is behind the shop_enabled flag; when it is off the routes answer 404.
import { supabase } from '../config/supabase';
import { listFlags } from './flags.service';
import { publicImageUrl } from './shopAdmin.service';

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
