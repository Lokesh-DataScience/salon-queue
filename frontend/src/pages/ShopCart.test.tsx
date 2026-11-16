// frontend/src/pages/ShopCart.test.tsx — Commerce C3: product page, device cart, server quote.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopProduct from './ShopProduct';
import ShopCart from './ShopCart';
import { renderPage } from '../test/utils';
import { resetLangForTests, setLang } from '../lib/i18n';
import { addToCart, clearCart, resetCartForTests } from '../lib/cart';
import { ApiError } from '../api/client';
import * as shop from '../api/shop';
import type { Quote, QuoteLine, ShopProductDetail } from '../api/shop';

vi.mock('../api/shop', () => ({ fetchShopProduct: vi.fn(), quoteCart: vi.fn() }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const oil: ShopProductDetail = {
  id: A, name: 'Beard Oil 50 ml', brand: 'Beardo', categoryId: null, mrpPaise: 25000, sellingPricePaise: 22000,
  discountPercent: 12, availability: 'IN_STOCK', image: null, description: 'Softens the beard.',
  images: [{ url: 'https://x.supabase.co/1.jpg', alt: 'front' }, { url: 'https://x.supabase.co/2.jpg', alt: 'back' }],
  maxPerOrder: 3, sameDayEligible: true,
};

const line = (o: Partial<QuoteLine>): QuoteLine => ({
  productId: A, qty: 1, problem: null, maxQty: null, unitPricePaise: 22000, mrpPaise: 25000, lineTotalPaise: 22000,
  name: 'Beard Oil 50 ml', brand: 'Beardo', image: null, ...o,
});
const quote = (lines: QuoteLine[], o: Partial<Quote> = {}): Quote => {
  const total = lines.reduce((n, l) => n + (l.lineTotalPaise ?? 0), 0);
  return { lines, subtotalPaise: total, deliveryFeePaise: 0, totalPaise: total, orderProblems: [], codMaxOrderPaise: 200000, ok: true, sameDayRequestable: false, ...o };
};

beforeEach(() => {
  localStorage.clear();
  resetLangForTests();
  setLang('en');
  clearCart();
  resetCartForTests();
  vi.mocked(shop.fetchShopProduct).mockReset().mockResolvedValue(oil);
  vi.mocked(shop.quoteCart).mockReset();
});

const savedCart = () => JSON.parse(localStorage.getItem('svq.cart.v1') ?? '[]');

describe('Product page', () => {
  it('shows price, MRP, saving, description and photos', async () => {
    renderPage(<ShopProduct />, { path: '/c/shop/p/:productId', route: `/c/shop/p/${A}` });
    expect(await screen.findByRole('heading', { name: 'Beard Oil 50 ml' })).toBeInTheDocument();
    expect(screen.getByText('₹220')).toBeInTheDocument();
    expect(screen.getByText('12% off')).toBeInTheDocument();
    expect(screen.getByText('You save ₹30')).toBeInTheDocument();
    expect(screen.getByText('Softens the beard.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Photo 2' })).toBeInTheDocument();
  });

  it('adds to the cart up to the per-order limit; the cart stores only ids, quantities and the seen price', async () => {
    const user = userEvent.setup();
    renderPage(<ShopProduct />, { path: '/c/shop/p/:productId', route: `/c/shop/p/${A}` });
    await user.click(await screen.findByRole('button', { name: 'One more' }));
    await user.click(screen.getByRole('button', { name: 'One more' }));
    expect(screen.getByRole('button', { name: 'One more' })).toBeDisabled(); // max 3
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(await screen.findByText('Added to cart')).toBeInTheDocument();
    expect(savedCart()).toEqual([{ productId: A, qty: 3, seenPricePaise: 22000 }]);
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled(); // already at the limit
    expect(screen.getByRole('link', { name: 'Cart, 3 items' })).toHaveAttribute('href', '/c/shop/cart');
    expect(JSON.stringify(localStorage)).not.toMatch(/Beard|name|phone|address/i);
  });

  it('out of stock: no add button', async () => {
    vi.mocked(shop.fetchShopProduct).mockResolvedValue({ ...oil, availability: 'OUT_OF_STOCK' });
    renderPage(<ShopProduct />, { path: '/c/shop/p/:productId', route: `/c/shop/p/${A}` });
    expect(await screen.findByText('Out of stock')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
  });

  it('hidden or removed product: friendly message', async () => {
    vi.mocked(shop.fetchShopProduct).mockRejectedValue(new ApiError('This product is not available.', 404));
    renderPage(<ShopProduct />, { path: '/c/shop/p/:productId', route: `/c/shop/p/${A}` });
    expect(await screen.findByText('This product is not available right now.')).toBeInTheDocument();
  });
});

describe('Cart', () => {
  it('empty cart', () => {
    renderPage(<ShopCart />, { path: '/c/shop/cart', route: '/c/shop/cart' });
    expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();
    expect(shop.quoteCart).not.toHaveBeenCalled();
  });

  it('asks the server for prices and shows its totals (sends ids + quantities only)', async () => {
    addToCart(A, 2, 22000);
    vi.mocked(shop.quoteCart).mockResolvedValue(quote([line({ qty: 2, lineTotalPaise: 44000 })]));
    renderPage(<ShopCart />, { path: '/c/shop/cart', route: '/c/shop/cart' });
    expect(await screen.findByText('Total (cash on delivery)')).toBeInTheDocument();
    expect(shop.quoteCart).toHaveBeenCalledWith([{ productId: A, qty: 2 }]);
    expect(screen.getAllByText('₹440').length).toBeGreaterThan(0);
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled(); // C4
  });

  it('points out a price change and remembers it once accepted', async () => {
    const user = userEvent.setup();
    addToCart(A, 1, 20000);
    vi.mocked(shop.quoteCart).mockResolvedValue(quote([line({})]));
    renderPage(<ShopCart />, { path: '/c/shop/cart', route: '/c/shop/cart' });
    expect(await screen.findByText('Price changed: ₹200 → ₹220')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByText(/Price changed/)).not.toBeInTheDocument());
    expect(savedCart()[0].seenPricePaise).toBe(22000);
  });

  it('limit and stock problems offer a one-tap fix; unavailable items can be removed', async () => {
    const user = userEvent.setup();
    addToCart(A, 5, 22000);
    addToCart(B, 1, 9000);
    vi.mocked(shop.quoteCart).mockResolvedValue(
      quote(
        [
          line({ qty: 5, problem: 'OVER_LIMIT', maxQty: 3, lineTotalPaise: null }),
          line({ productId: B, problem: 'UNAVAILABLE', unitPricePaise: null, mrpPaise: null, lineTotalPaise: null, name: null }),
        ],
        { ok: false },
      ),
    );
    renderPage(<ShopCart />, { path: '/c/shop/cart', route: '/c/shop/cart' });
    expect(await screen.findByText('Up to 3 per order')).toBeInTheDocument();
    expect(screen.getAllByText('No longer available').length).toBeGreaterThan(0);
    expect(screen.getByText('Please fix the items marked in red.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change to 3' }));
    expect(savedCart().find((i: { productId: string }) => i.productId === A).qty).toBe(3);
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    expect(savedCart().map((i: { productId: string }) => i.productId)).toEqual([A]);
  });

  it('over the cash-on-delivery limit', async () => {
    addToCart(A, 1, 22000);
    vi.mocked(shop.quoteCart).mockResolvedValue(quote([line({})], { ok: false, orderProblems: ['OVER_COD_LIMIT'], codMaxOrderPaise: 20000 }));
    renderPage(<ShopCart />, { path: '/c/shop/cart', route: '/c/shop/cart' });
    expect(await screen.findByText(/Cash-on-delivery orders can be up to ₹200/)).toBeInTheDocument();
  });

  it('quote fails: message and retry', async () => {
    addToCart(A, 1, 22000);
    vi.mocked(shop.quoteCart).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(quote([line({})]));
    const user = userEvent.setup();
    renderPage(<ShopCart />, { path: '/c/shop/cart', route: '/c/shop/cart' });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Total (cash on delivery)')).toBeInTheDocument();
  });
});

describe('cart store', () => {
  it('ignores tampered or broken saved data', () => {
    localStorage.setItem('svq.cart.v1', JSON.stringify([{ productId: A, qty: 999, seenPricePaise: 1 }, { productId: 'x', qty: 1, seenPricePaise: 1 }, 'junk']));
    resetCartForTests();
    renderPage(<ShopCart />, { path: '/c/shop/cart', route: '/c/shop/cart' });
    expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();
  });
});
