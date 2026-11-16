// frontend/src/components/admin/shop/ShopSection.test.tsx — Shop tab (Commerce C1).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopSection from './ShopSection';
import { renderPage } from '../../../test/utils';
import * as admin from '../../../api/admin';
import * as shop from '../../../api/shopAdmin';
import type { ShopProduct } from '../../../api/shopAdmin';

vi.mock('../../../api/admin', () => ({ fetchAdminMe: vi.fn() }));
vi.mock('../../../api/shopAdmin', async (orig) => {
  const real = await orig<typeof import('../../../api/shopAdmin')>();
  return {
    ...real,
    fetchShopProducts: vi.fn(),
    fetchShopCategories: vi.fn(),
    fetchShopSettings: vi.fn(),
    createShopProduct: vi.fn(),
  };
});

const oil: ShopProduct = {
  id: 'p1', sku: 'BRD-OIL-50', name: 'Beard Oil 50 ml', brand: 'Beardo', description: '', categoryId: null,
  mrpPaise: 25000, sellingPricePaise: 22000, wholesaleCostPaise: 18000, marginPaise: 4000, marginWarning: false,
  stockOnHand: 10, stockReserved: 0, stockBuffer: 1, sellable: 9, maxPerOrder: 5, isActive: true, isVisible: false,
  sameDayEligible: true, lastStockCheckAt: null, deletedAt: null, updatedAt: '2026-11-16T08:00:00Z', images: [],
};

const render = () => renderPage(<ShopSection />, { path: '/barber/admin', route: '/barber/admin?tab=shop' });

beforeEach(() => {
  vi.mocked(admin.fetchAdminMe).mockReset().mockResolvedValue({ role: 'FOUNDER', sections: ['founder', 'sales', 'tech'] });
  vi.mocked(shop.fetchShopProducts).mockReset().mockResolvedValue([oil]);
  vi.mocked(shop.fetchShopCategories).mockReset().mockResolvedValue([]);
  vi.mocked(shop.createShopProduct).mockReset().mockResolvedValue({ ...oil, id: 'p2' });
});

describe('Shop tab', () => {
  it('lists products with price, cost, margin and stock', async () => {
    render();
    expect(await screen.findByText('Beard Oil 50 ml')).toBeInTheDocument();
    expect(screen.getByText(/Sell ₹220 \(MRP ₹250\) · Cost ₹180 · Margin ₹40/)).toBeInTheDocument();
    expect(screen.getByText(/In stock 10 · Reserved 0 · Can sell 9/)).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
  });

  it('founder can add a product; selling price at or above MRP is stopped before sending', async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: '+ Add product' }));
    await user.type(screen.getByLabelText(/^Name/), 'Face Wash 100 g');
    await user.type(screen.getByLabelText(/^SKU/), 'FW-100');
    await user.type(screen.getByLabelText('MRP (₹)'), '150');
    await user.type(screen.getByLabelText('Selling price (₹)'), '150');
    await user.type(screen.getByLabelText('Wholesale cost (₹)'), '110');
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Selling price must be lower than MRP.');
    expect(shop.createShopProduct).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Selling price (₹)'));
    await user.type(screen.getByLabelText('Selling price (₹)'), '129.50');
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    expect(shop.createShopProduct).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'FW-100', mrpPaise: 15000, sellingPricePaise: 12950, wholesaleCostPaise: 11000, initialStock: 0 }),
    );
  });

  it('shows a no-profit warning while typing prices', async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: '+ Add product' }));
    await user.type(screen.getByLabelText('Selling price (₹)'), '100');
    await user.type(screen.getByLabelText('Wholesale cost (₹)'), '120');
    expect(screen.getByText(/you would make no profit/)).toBeInTheDocument();
  });

  it('cofounder sees the view-only note and no add button', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'COFOUNDER', sections: ['founder', 'sales', 'tech'] });
    render();
    expect(await screen.findByText('Beard Oil 50 ml')).toBeInTheDocument();
    expect(await screen.findByText(/View only\. Only the founder/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add product' })).not.toBeInTheDocument();
  });
});
