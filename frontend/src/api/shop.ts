// frontend/src/api/shop.ts — the customer shop catalog (Commerce Phase 1, C2). Read-only, no login.
// The server answers 404 for the catalog while the shop is switched off.
import { apiFetch } from './client';

export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface ShopCatalogProduct {
  id: string;
  name: string;
  brand: string;
  categoryId: string | null;
  mrpPaise: number;
  sellingPricePaise: number;
  discountPercent: number;
  availability: Availability;
  image: { url: string; alt: string } | null;
}

export interface ShopCatalogCategory {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string;
}

export interface ShopStatus {
  enabled: boolean;
  showStrip: boolean;
}

export const fetchShopStatus = (salonId?: string) =>
  apiFetch<ShopStatus>(`/api/shop/status${salonId ? `?salonId=${encodeURIComponent(salonId)}` : ''}`);

export const fetchCatalog = (categoryId?: string) =>
  apiFetch<{ products: ShopCatalogProduct[] }>(
    `/api/shop/products${categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : ''}`,
  ).then((r) => r.products);

export const fetchCatalogCategories = () =>
  apiFetch<{ categories: ShopCatalogCategory[] }>('/api/shop/categories').then((r) => r.categories);

// ── C3: product page + server quote ──────────────────────────────────────

export interface ShopProductDetail extends ShopCatalogProduct {
  description: string;
  images: { url: string; alt: string }[];
  maxPerOrder: number;
  sameDayEligible: boolean;
}

export const fetchShopProduct = (productId: string) =>
  apiFetch<{ product: ShopProductDetail }>(`/api/shop/products/${encodeURIComponent(productId)}`).then((r) => r.product);

export type LineProblem = 'UNAVAILABLE' | 'NOT_ENOUGH_STOCK' | 'OVER_LIMIT';

export interface QuoteLine {
  productId: string;
  qty: number;
  problem: LineProblem | null;
  maxQty: number | null;
  unitPricePaise: number | null;
  mrpPaise: number | null;
  lineTotalPaise: number | null;
  name: string | null;
  brand: string | null;
  image: { url: string; alt: string } | null;
}

export interface Quote {
  lines: QuoteLine[];
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  orderProblems: string[];
  codMaxOrderPaise: number | null;
  ok: boolean;
  sameDayRequestable: boolean;
}

// Prices always come from the server; the phone only says which products and how many.
export const quoteCart = (items: { productId: string; qty: number }[]) =>
  apiFetch<{ quote: Quote }>('/api/shop/quote', { method: 'POST', body: JSON.stringify({ items }) }).then((r) => r.quote);
