// backend/src/services/shopAdmin.service.ts — Shop admin (Commerce Phase 1, C1): catalog, stock, settings.
// Reads: FOUNDER and COFOUNDER (D7 — including wholesale cost and margin).
// Writes: FOUNDER only. The route guard checks it, and every shop_* database function checks it again.
// No customer data exists in C1. Logs carry ids and codes only.
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { logAdminAction } from './admin.service';
import type { Actor } from './founderSalons.service';

export const SHOP_IMAGE_BUCKET = 'shop-product-images';
export const SHOP_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const SHOP_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type ImageType = (typeof SHOP_IMAGE_TYPES)[number];
const EXT: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// ── Errors from the shop_* database functions ────────────────────────────

const CODE_MESSAGES: Record<string, [number, string]> = {
  SHOP_FORBIDDEN: [403, 'Only the founder can do this.'],
  SHOP_NOT_FOUND: [404, 'Not found. It may have been deleted — refresh the page.'],
  SHOP_STALE: [409, 'Stock changed since you opened this screen. Refresh and try again.'],
  SHOP_BELOW_RESERVED: [409, "Stock can't go below the units reserved by open orders."],
  SHOP_INVALID_QTY: [400, 'That quantity is not valid.'],
  SHOP_REASON_REQUIRED: [400, 'Please write a reason (at least 3 characters).'],
  SHOP_HAS_RESERVATIONS: [409, 'Open orders have reserved this product. Hide it instead of deleting it.'],
  SHOP_TOO_MANY_IMAGES: [409, 'A product can have at most 6 photos.'],
  SHOP_DUPLICATE_ITEM: [400, 'Each product can appear only once.'],
  SHOP_NO_SUPPLIER: [409, 'No active supplier is set up. Add it in Shop settings.'],
  SHOP_INVALID_INPUT: [400, 'Invalid request.'],
};

const CONSTRAINT_MESSAGES: Record<string, [number, string]> = {
  products_sku_live_uq: [409, 'Another product already uses this SKU.'],
  products_price_below_mrp: [400, 'Selling price must be lower than MRP.'],
  product_categories_slug_key: [409, 'Another category already uses this short name.'],
  products_category_id_fkey: [400, 'That category no longer exists. Refresh and pick again.'],
};

interface PgError {
  code?: string;
  message?: string;
}

// Turns a database error into a human-readable AppError. Unknown errors are re-thrown untouched
// (the central handler logs name + code only and answers 500).
export function shopDbError(err: unknown): never {
  const e = (err ?? {}) as PgError;
  const msg = e.message ?? '';
  const code = Object.keys(CODE_MESSAGES).find((c) => msg === c || msg.startsWith(`${c}:`));
  if (code) {
    const [status, text] = CODE_MESSAGES[code];
    throw new AppError(text, status);
  }
  if (e.code === '23505' || e.code === '23514' || e.code === '23503') {
    const constraint = Object.keys(CONSTRAINT_MESSAGES).find((c) => msg.includes(c));
    if (constraint) {
      const [status, text] = CONSTRAINT_MESSAGES[constraint];
      throw new AppError(text, status);
    }
    if (e.code === '23514') throw new AppError('Some details are out of range. Check the numbers and try again.', 400);
    if (e.code === '23505') throw new AppError('That already exists.', 409);
  }
  if (e.code === '22P02' || e.code === '22007' || e.code === '22008') throw new AppError('Invalid request.', 400);
  throw err;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) shopDbError(error);
  return data as T;
}

// ── DTOs ─────────────────────────────────────────────────────────────────

export function publicImageUrl(storagePath: string): string {
  return `${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${SHOP_IMAGE_BUCKET}/${storagePath}`;
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  brand: string;
  description: string;
  category_id: string | null;
  mrp_paise: number;
  selling_price_paise: number;
  wholesale_cost_paise: number;
  stock_on_hand: number;
  stock_reserved: number;
  stock_buffer: number;
  max_per_order: number;
  is_active: boolean;
  is_visible: boolean;
  same_day_eligible: boolean;
  last_stock_check_at: string | null;
  deleted_at: string | null;
  updated_at: string;
  product_images?: { id: string; storage_path: string; sort_order: number; alt: string }[];
}

const PRODUCT_COLUMNS =
  'id, sku, name, brand, description, category_id, mrp_paise, selling_price_paise, wholesale_cost_paise, ' +
  'stock_on_hand, stock_reserved, stock_buffer, max_per_order, is_active, is_visible, same_day_eligible, ' +
  'last_stock_check_at, deleted_at, updated_at, product_images (id, storage_path, sort_order, alt)';

function toProduct(r: ProductRow) {
  const images = [...(r.product_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({ id: i.id, url: publicImageUrl(i.storage_path), sortOrder: i.sort_order, alt: i.alt }));
  const marginPaise = r.selling_price_paise - r.wholesale_cost_paise;
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    brand: r.brand,
    description: r.description,
    categoryId: r.category_id,
    mrpPaise: r.mrp_paise,
    sellingPricePaise: r.selling_price_paise,
    wholesaleCostPaise: r.wholesale_cost_paise,
    marginPaise,
    marginWarning: marginPaise <= 0, // allowed, but the founder is warned (§4.2)
    stockOnHand: r.stock_on_hand,
    stockReserved: r.stock_reserved,
    stockBuffer: r.stock_buffer,
    sellable: Math.max(0, r.stock_on_hand - r.stock_reserved - r.stock_buffer),
    maxPerOrder: r.max_per_order,
    isActive: r.is_active,
    isVisible: r.is_visible,
    sameDayEligible: r.same_day_eligible,
    lastStockCheckAt: r.last_stock_check_at,
    deletedAt: r.deleted_at,
    updatedAt: r.updated_at,
    images,
  };
}
export type ShopAdminProduct = ReturnType<typeof toProduct>;

// ── Reads (founder + cofounder) ──────────────────────────────────────────

export async function listProducts(q: { search?: string; categoryId?: string; includeDeleted: boolean }) {
  let query = supabase.from('products').select(PRODUCT_COLUMNS).order('name').limit(500);
  if (!q.includeDeleted) query = query.is('deleted_at', null);
  if (q.categoryId) query = query.eq('category_id', q.categoryId);
  if (q.search) {
    // PostgREST "or" filter: strip the characters that have meaning in its syntax.
    const s = q.search.replace(/[,()*%\\]/g, ' ').trim();
    if (s) query = query.or(`name.ilike.*${s}*,sku.ilike.*${s}*,brand.ilike.*${s}*`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as ProductRow[]).map(toProduct);
}

export async function getProduct(productId: string) {
  const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS).eq('id', productId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Product not found.', 404);
  return toProduct(data as unknown as ProductRow);
}

export async function listMovements(productId: string, limit: number) {
  await getProduct(productId); // 404 for unknown ids
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('id, movement_type, qty_change, on_hand_before, on_hand_after, reserved_before, reserved_after, reason, actor_type, created_at, salon_staff (name)')
    .eq('product_id', productId)
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((m) => {
    const staff = (m as { salon_staff?: { name?: string } | { name?: string }[] | null }).salon_staff;
    const actorName = Array.isArray(staff) ? staff[0]?.name : staff?.name;
    return {
      id: Number(m.id),
      type: m.movement_type as string,
      qtyChange: m.qty_change as number,
      onHandBefore: m.on_hand_before as number,
      onHandAfter: m.on_hand_after as number,
      reservedBefore: m.reserved_before as number,
      reservedAfter: m.reserved_after as number,
      reason: m.reason as string,
      actorType: m.actor_type as string,
      actorName: actorName ?? null, // staff only; customers never appear here
      createdAt: m.created_at as string,
    };
  });
}

export async function listCategories() {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, slug, name_en, name_hi, sort_order, is_active')
    .order('sort_order')
    .order('name_en');
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id as string,
    slug: c.slug as string,
    nameEn: c.name_en as string,
    nameHi: c.name_hi as string,
    sortOrder: c.sort_order as number,
    isActive: c.is_active as boolean,
  }));
}

export async function getSettings() {
  const [{ data: s, error: e1 }, { data: sup, error: e2 }] = await Promise.all([
    supabase.from('shop_settings').select('*').eq('id', true).maybeSingle(),
    supabase.from('suppliers').select('id, name, phone, notes').eq('is_active', true).maybeSingle(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (!s) throw new AppError('Shop is not set up yet. Run step21 first.', 503);
  return {
    settings: {
      sameDayCutoff: s.same_day_cutoff ? String(s.same_day_cutoff).slice(0, 5) : null,
      codMaxOrderPaise: s.cod_max_order_paise as number,
      maxOpenCodOrdersPerCustomer: s.max_open_cod_orders_per_customer as number,
      founderContactPhone: s.founder_contact_phone as string,
      placedReminderAfterMinutes: s.placed_reminder_after_minutes as number,
      placedReminderRepeatMinutes: s.placed_reminder_repeat_minutes as number,
      updatedAt: s.updated_at as string,
    },
    supplier: sup
      ? { id: sup.id as string, name: sup.name as string, phone: sup.phone as string, notes: sup.notes as string }
      : null,
  };
}

// ── Writes (founder only; the database re-checks) ────────────────────────

type ProductInput = Partial<{
  categoryId: string | null;
  sku: string;
  name: string;
  description: string;
  brand: string;
  mrpPaise: number;
  sellingPricePaise: number;
  wholesaleCostPaise: number;
  stockBuffer: number;
  maxPerOrder: number;
  isActive: boolean;
  sameDayEligible: boolean;
}>;

const FIELD_MAP: Record<keyof ProductInput, string> = {
  categoryId: 'category_id',
  sku: 'sku',
  name: 'name',
  description: 'description',
  brand: 'brand',
  mrpPaise: 'mrp_paise',
  sellingPricePaise: 'selling_price_paise',
  wholesaleCostPaise: 'wholesale_cost_paise',
  stockBuffer: 'stock_buffer',
  maxPerOrder: 'max_per_order',
  isActive: 'is_active',
  sameDayEligible: 'same_day_eligible',
};

function toDbFields(input: ProductInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(FIELD_MAP)) {
    const v = input[k as keyof ProductInput];
    if (v !== undefined) out[col] = v;
  }
  return out;
}

export async function createProduct(actor: Actor, input: ProductInput & { initialStock: number }) {
  const { initialStock, ...fields } = input;
  const id = await rpc<string>('shop_save_product', {
    p_actor: actor.staffId,
    p_product_id: null,
    p_fields: toDbFields(fields),
    p_initial_stock: initialStock,
  });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.product_create',
    targetType: 'product',
    targetId: id,
    details: { sku: fields.sku, initialStock },
  });
  return getProduct(id);
}

export async function updateProduct(actor: Actor, productId: string, input: ProductInput) {
  await rpc('shop_save_product', {
    p_actor: actor.staffId,
    p_product_id: productId,
    p_fields: toDbFields(input),
    p_initial_stock: 0,
  });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.product_update',
    targetType: 'product',
    targetId: productId,
    details: { fields: Object.keys(input) },
  });
  return getProduct(productId);
}

export async function setAvailability(actor: Actor, productId: string, available: boolean) {
  await rpc('shop_set_product_visibility', { p_actor: actor.staffId, p_product_id: productId, p_visible: available });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: available ? 'shop.product_show' : 'shop.product_hide',
    targetType: 'product',
    targetId: productId,
  });
  return getProduct(productId);
}

export async function deleteProduct(actor: Actor, productId: string) {
  await rpc('shop_delete_product', { p_actor: actor.staffId, p_product_id: productId });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.product_delete',
    targetType: 'product',
    targetId: productId,
  });
}

export async function changeStock(
  actor: Actor,
  productId: string,
  input: { type: 'STOCK_COUNT' | 'MANUAL_ADJUSTMENT' | 'DAMAGED_STOCK'; qty: number; expectedOnHand: number; reason: string },
) {
  await rpc('shop_adjust_stock', {
    p_actor: actor.staffId,
    p_product_id: productId,
    p_type: input.type,
    p_qty: input.qty,
    p_expected_on_hand: input.expectedOnHand,
    p_reason: input.reason,
  });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.stock_change',
    targetType: 'product',
    targetId: productId,
    details: { type: input.type, qty: input.qty },
  });
  return getProduct(productId);
}

export async function dailyStockCheck(
  actor: Actor,
  items: { productId: string; counted: number; expectedOnHand: number }[],
) {
  const result = await rpc<{ checked: number; changed: number }>('shop_stock_check', {
    p_actor: actor.staffId,
    p_items: items.map((i) => ({ product_id: i.productId, counted: i.counted, expected_on_hand: i.expectedOnHand })),
  });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.stock_check',
    targetType: 'shop',
    details: result,
  });
  return result;
}

// ── Images ───────────────────────────────────────────────────────────────

// Checks the first bytes, so a renamed file can't pretend to be an image.
export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export async function addImage(actor: Actor, productId: string, declaredType: string, body: Buffer, alt: string) {
  if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError('Choose a photo to upload.', 400);
  if (body.length > SHOP_IMAGE_MAX_BYTES) throw new AppError('Photo is too large (max 2 MB).', 413);
  const sniffed = sniffImageType(body);
  if (!sniffed || sniffed !== declaredType) throw new AppError('Only JPG, PNG or WebP photos are allowed.', 400);

  await getProduct(productId); // 404 before uploading anything
  const path = `products/${productId}/${randomUUID()}.${EXT[sniffed]}`;
  const { error: upErr } = await supabase.storage
    .from(SHOP_IMAGE_BUCKET)
    .upload(path, body, { contentType: sniffed, upsert: false, cacheControl: '31536000' });
  if (upErr) throw upErr;

  try {
    const imageId = await rpc<string>('shop_add_product_image', {
      p_actor: actor.staffId,
      p_product_id: productId,
      p_storage_path: path,
      p_alt: alt,
    });
    await logAdminAction({
      actorStaffId: actor.staffId,
      actorRole: actor.role,
      action: 'shop.image_add',
      targetType: 'product',
      targetId: productId,
      details: { imageId },
    });
  } catch (err) {
    // The row wasn't saved (e.g. 7th photo): don't leave the file behind.
    await supabase.storage.from(SHOP_IMAGE_BUCKET).remove([path]);
    throw err;
  }
  return getProduct(productId);
}

export async function updateImage(
  actor: Actor,
  productId: string,
  imageId: string,
  input: { sortOrder?: number; alt?: string },
) {
  await rpc('shop_update_product_image', {
    p_actor: actor.staffId,
    p_product_id: productId,
    p_image_id: imageId,
    p_sort_order: input.sortOrder ?? null,
    p_alt: input.alt ?? null,
  });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.image_update',
    targetType: 'product',
    targetId: productId,
    details: { imageId },
  });
  return getProduct(productId);
}

export async function deleteImage(actor: Actor, productId: string, imageId: string) {
  const path = await rpc<string>('shop_delete_product_image', {
    p_actor: actor.staffId,
    p_product_id: productId,
    p_image_id: imageId,
  });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.image_delete',
    targetType: 'product',
    targetId: productId,
    details: { imageId },
  });
  // The row is gone either way; a leftover file is harmless (unreferenced), so don't fail the request.
  const { error } = await supabase.storage.from(SHOP_IMAGE_BUCKET).remove([path]);
  if (error) console.warn(`[shop] image file not removed image=${imageId} code=${(error as PgError).code ?? 'storage'}`);
  return getProduct(productId);
}

// ── Categories, settings, supplier ───────────────────────────────────────

const CATEGORY_MAP = { slug: 'slug', nameEn: 'name_en', nameHi: 'name_hi', sortOrder: 'sort_order', isActive: 'is_active' } as const;

export async function saveCategory(
  actor: Actor,
  categoryId: string | null,
  input: Partial<Record<keyof typeof CATEGORY_MAP, unknown>>,
) {
  const fields: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(CATEGORY_MAP)) {
    const v = input[k as keyof typeof CATEGORY_MAP];
    if (v !== undefined) fields[col] = v;
  }
  const id = await rpc<string>('shop_save_category', { p_actor: actor.staffId, p_id: categoryId, p_fields: fields });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: categoryId ? 'shop.category_update' : 'shop.category_create',
    targetType: 'category',
    targetId: id,
    details: { fields: Object.keys(input) },
  });
  return (await listCategories()).find((c) => c.id === id)!;
}

export async function updateSettings(
  actor: Actor,
  input: Partial<{
    sameDayCutoff: string | null;
    codMaxOrderPaise: number;
    maxOpenCodOrdersPerCustomer: number;
    founderContactPhone: string;
    placedReminderAfterMinutes: number;
    placedReminderRepeatMinutes: number;
  }>,
) {
  const map = {
    sameDayCutoff: 'same_day_cutoff',
    codMaxOrderPaise: 'cod_max_order_paise',
    maxOpenCodOrdersPerCustomer: 'max_open_cod_orders_per_customer',
    founderContactPhone: 'founder_contact_phone',
    placedReminderAfterMinutes: 'placed_reminder_after_minutes',
    placedReminderRepeatMinutes: 'placed_reminder_repeat_minutes',
  } as const;
  const fields: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(map)) {
    const v = input[k as keyof typeof map];
    if (v !== undefined) fields[col] = v;
  }
  await rpc('shop_update_settings', { p_actor: actor.staffId, p_fields: fields });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.settings_update',
    targetType: 'shop',
    details: { fields: Object.keys(input) }, // never the phone number itself
  });
  return getSettings();
}

export async function updateSupplier(actor: Actor, input: Partial<{ name: string; phone: string; notes: string }>) {
  await rpc('shop_update_supplier', { p_actor: actor.staffId, p_fields: input });
  await logAdminAction({
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    action: 'shop.supplier_update',
    targetType: 'supplier',
    details: { fields: Object.keys(input) },
  });
  return getSettings();
}
