// frontend/src/pages/ShopHome.test.tsx — Commerce C2: customer Shop tab, Shop strip, 5th bottom tab.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ShopHome from './ShopHome';
import ShopStrip from '../components/shop/ShopStrip';
import CustomerChrome, { showsBottomNav } from '../components/CustomerChrome';
import { renderPage } from '../test/utils';
import { resetLangForTests, setLang } from '../lib/i18n';
import { setShopEnabledForTests } from '../lib/shopStatus';
import { ApiError } from '../api/client';
import * as shop from '../api/shop';
import type { ShopCatalogProduct } from '../api/shop';

vi.mock('../api/shop', () => ({ fetchCatalog: vi.fn(), fetchCatalogCategories: vi.fn(), fetchShopStatus: vi.fn() }));

const oil: ShopCatalogProduct = {
  id: 'p1', name: 'Beard Oil 50 ml', brand: 'Beardo', categoryId: 'c-beard', mrpPaise: 25000, sellingPricePaise: 22000,
  discountPercent: 12, availability: 'IN_STOCK', image: { url: 'https://x.supabase.co/a.jpg', alt: 'Beard Oil' },
};
const wash: ShopCatalogProduct = {
  ...oil, id: 'p2', name: 'Face Wash 100 g', brand: '', categoryId: 'c-skin', availability: 'LOW_STOCK', image: null, discountPercent: 0,
};
const gone: ShopCatalogProduct = { ...oil, id: 'p3', name: 'Hair Wax', availability: 'OUT_OF_STOCK' };

beforeEach(() => {
  localStorage.clear();
  resetLangForTests();
  setLang('en');
  vi.mocked(shop.fetchCatalog).mockReset().mockResolvedValue([oil, wash, gone]);
  vi.mocked(shop.fetchCatalogCategories).mockReset().mockResolvedValue([
    { id: 'c-beard', slug: 'beard-care', nameEn: 'Beard care', nameHi: 'दाढ़ी की देखभाल' },
    { id: 'c-skin', slug: 'skin-care', nameEn: 'Skin care', nameHi: 'त्वचा की देखभाल' },
  ]);
  vi.mocked(shop.fetchShopStatus).mockReset().mockResolvedValue({ enabled: true, showStrip: true });
});

describe('Shop tab page (/c/shop)', () => {
  it('shows products with price, MRP, discount and stock labels — never stock numbers', async () => {
    renderPage(<ShopHome />, { path: '/c/shop', route: '/c/shop' });
    expect(await screen.findByText('Beard Oil 50 ml')).toBeInTheDocument();
    expect(screen.getAllByText('₹220')).toHaveLength(3); // same test price on all three
    expect(screen.getByText('12% off')).toBeInTheDocument(); // not on the out-of-stock one
    expect(screen.getByText('Only a few left')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Beard Oil' })[0]).toHaveAttribute('src', 'https://x.supabase.co/a.jpg');
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    renderPage(<ShopHome />, { path: '/c/shop', route: '/c/shop' });
    await user.click(await screen.findByRole('button', { name: 'Skin care' }));
    await waitFor(() => expect(shop.fetchCatalog).toHaveBeenLastCalledWith('c-skin'));
    expect(screen.getByRole('button', { name: 'Skin care' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Hindi by default', async () => {
    localStorage.clear();
    resetLangForTests();
    renderPage(<ShopHome />, { path: '/c/shop', route: '/c/shop' });
    expect(await screen.findByRole('button', { name: 'दाढ़ी की देखभाल' })).toBeInTheDocument();
  });

  it('switched off: a friendly "not open yet" page', async () => {
    vi.mocked(shop.fetchCatalog).mockRejectedValue(new ApiError('Not found.', 404));
    renderPage(<ShopHome />, { path: '/c/shop', route: '/c/shop' });
    expect(await screen.findByText("The shop isn't open yet")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My salons' })).toHaveAttribute('href', '/c');
  });
});

describe('Shop strip on the ticket page', () => {
  it('shows in-stock products and links to the Shop tab', async () => {
    renderPage(<ShopStrip salonId="s1" />);
    expect(await screen.findByRole('region', { name: 'From the shop' })).toBeInTheDocument();
    expect(shop.fetchShopStatus).toHaveBeenCalledWith('s1');
    expect(screen.queryByText('Hair Wax')).not.toBeInTheDocument(); // out of stock is left out
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/c/shop');
  });

  it('renders nothing when the strip is not on for this salon, and never loads the catalog', async () => {
    vi.mocked(shop.fetchShopStatus).mockResolvedValue({ enabled: true, showStrip: false });
    const { container } = renderPage(<ShopStrip salonId="s1" />);
    await waitFor(() => expect(shop.fetchShopStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(shop.fetchCatalog).not.toHaveBeenCalled();
  });

  it('renders nothing on an error', async () => {
    vi.mocked(shop.fetchShopStatus).mockRejectedValue(new Error('offline'));
    const { container } = renderPage(<ShopStrip salonId="s1" />);
    await waitFor(() => expect(shop.fetchShopStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('5th bottom tab', () => {
  it('appears only while the shop is on', async () => {
    setShopEnabledForTests(false);
    const { unmount } = render(
      <MemoryRouter initialEntries={['/c']}>
        <CustomerChrome />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('link')).toHaveLength(4);
    unmount();

    setShopEnabledForTests(true);
    render(
      <MemoryRouter initialEntries={['/c/shop']}>
        <CustomerChrome />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/c', '/c/tokens', '/c/scan', '/c/history', '/c/shop']);
    expect(screen.getByRole('link', { name: /Shop/ })).toHaveAttribute('aria-current', 'page');
    setShopEnabledForTests(false);
  });

  it('the bar shows on /c/shop (browser tab and installed app)', () => {
    expect(showsBottomNav('/c/shop', false)).toBe(true);
    expect(showsBottomNav('/c/shop/', true)).toBe(true);
  });
});
