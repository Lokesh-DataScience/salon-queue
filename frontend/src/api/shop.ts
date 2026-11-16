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
