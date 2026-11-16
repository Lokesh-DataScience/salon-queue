// frontend/src/components/admin/shop/ShopOrders.test.tsx — the founder's order screens (Commerce C5a).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopSection from './ShopSection';
import { renderPage } from '../../../test/utils';
import * as admin from '../../../api/admin';
import * as shop from '../../../api/shopAdmin';
import type { AdminOrderDetail, AdminOrderStatus } from '../../../api/shopAdmin';

vi.mock('../../../api/admin', () => ({ fetchAdminMe: vi.fn() }));
vi.mock('../../../api/shopAdmin', async (orig) => {
  const real = await orig<typeof import('../../../api/shopAdmin')>();
  return {
    ...real,
    fetchShopOrders: vi.fn(),
    fetchShopOrder: vi.fn(),
    fetchSupplierText: vi.fn(),
    transitionShopOrder: vi.fn(),
    recordShopCod: vi.fn(),
    setShopDeliveryExpectation: vi.fn(),
  };
});

function detail(status: AdminOrderStatus, over: Partial<AdminOrderDetail['order']> = {}): AdminOrderDetail {
  return {
    order: {
      id: 'o1', orderNumber: 'SQ-1042', customerId: 'c1', status, paymentMethod: 'COD', paymentStatus: 'COD_PENDING',
      createdAt: '2026-11-16T05:00:00Z', updatedAt: '2026-11-16T05:00:00Z', deliveredAt: null,
      customer: { name: 'Ravi', phone: '+919876543210', addressLine1: '12 Main Road', addressLine2: '', landmark: 'temple', pincode: '495001' },
      subtotalPaise: 44000, deliveryFeePaise: 0, totalPaise: 44000, sameDayState: 'NOT_REQUESTED',
      expectedDeliveryDate: null, expectedDeliveryNote: '', cod: { collectedPaise: null, collectedAt: null, mismatchNote: '' },
      supplier: { name: 'Sharma Traders', phone: '9800000000' }, supplierContactedAt: null, fromSalon: false,
      cancelReason: null, cancelledBy: null, remindersSent: 0, supplierSettled: false, ...over,
    },
    items: [
      {
        id: 'i1', productId: 'p1', productName: 'Beard Oil 50 ml', sku: 'BRD-50', mrpPaise: 25000, unitPricePaise: 22000, quantity: 2,
        lineTotalPaise: 44000, expectedUnitCostPaise: 18000, confirmedUnitCostPaise: null, stockState: 'RESERVED', lineProfitPaise: 8000,
        cancelRestockQty: 0, cancelWriteOffQty: 0, returnedQty: 0, keptUnits: 2,
      },
    ],
    finance: { costPaise: 36000, grossProfitPaise: 8000, costsConfirmed: false, expensesPaise: 0, netProfitPaise: 8000 },
    expenses: [],
    events: [{ id: 'e1', type: 'placed', from: null, to: 'PLACED', customerVisible: true, note: '', actorType: 'CUSTOMER', at: '2026-11-16T05:00:00Z' }],
  };
}

const render = (route = '/barber/admin?tab=shop') => renderPage(<ShopSection />, { path: '/barber/admin', route });
const openOrder = () => render('/barber/admin?tab=shop&view=orders&order=o1');

beforeEach(() => {
  vi.mocked(admin.fetchAdminMe).mockReset().mockResolvedValue({ role: 'FOUNDER', sections: ['founder', 'sales', 'tech'] });
  vi.mocked(shop.fetchShopOrders).mockReset().mockResolvedValue({
    counts: { PLACED: 1, SUPPLIER_PENDING: 1 },
    orders: [
      {
        id: 'o1', orderNumber: 'SQ-1042', status: 'PLACED', paymentStatus: 'COD_PENDING', totalPaise: 44000, itemCount: 2,
        sameDayState: 'REQUESTED', expectedDeliveryDate: null, customerName: 'Ravi', pincode: '495001',
        createdAt: '2026-11-16T05:00:00Z', updatedAt: '2026-11-16T05:00:00Z', remindersSent: 0, needs: null,
      },
    ],
  });
  vi.mocked(shop.fetchShopOrder).mockReset().mockResolvedValue(detail('PLACED'));
  vi.mocked(shop.fetchSupplierText).mockReset().mockResolvedValue({
    text: 'Namaste! Order SQ-1042:\n1. Beard Oil 50 ml (BRD-50) × 2', supplierName: 'Sharma Traders',
    whatsappUrl: 'https://wa.me/919800000000?text=x',
  });
  vi.mocked(shop.transitionShopOrder).mockReset();
  vi.mocked(shop.recordShopCod).mockReset();
});

describe('Shop orders (founder)', () => {
  it('Orders is the default view; the list shows new orders, same-day and totals', async () => {
    render();
    expect(await screen.findByText('SQ-1042')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 new order is waiting for you.');
    expect(screen.getByText('Same day asked')).toBeInTheDocument();
    expect(screen.getByText(/Ravi · 495001 · 2 items · ₹440 COD/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open (2)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a new order shows the supplier message and moves on with the status the screen showed', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.transitionShopOrder).mockResolvedValue(detail('SUPPLIER_PENDING'));
    openOrder();
    expect(await screen.findByText(/Namaste! Order SQ-1042/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', 'https://wa.me/919800000000?text=x');
    expect(screen.getByText(/Profit/)).toHaveTextContent('Profit ₹80 (expected');
    await user.click(screen.getByRole('button', { name: "I've asked the supplier" }));
    expect(shop.transitionShopOrder).toHaveBeenCalledWith('o1', { to: 'SUPPLIER_PENDING', expectedFrom: 'PLACED' });
    expect(await screen.findByRole('button', { name: 'Supplier confirmed' })).toBeInTheDocument();
  });

  it('confirming sends the supplier rate per item and the delivery date; a bad rate is stopped', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('SUPPLIER_PENDING'));
    vi.mocked(shop.transitionShopOrder).mockResolvedValue(detail('SUPPLIER_CONFIRMED'));
    openOrder();
    const rate = await screen.findByLabelText(/Beard Oil 50 ml × 2 — supplier rate/);
    expect(rate).toHaveValue('180');
    await user.clear(rate);
    await user.type(rate, 'abc');
    await user.click(screen.getByRole('button', { name: 'Supplier confirmed' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Enter the supplier's rate for every item");
    expect(shop.transitionShopOrder).not.toHaveBeenCalled();

    await user.clear(rate);
    await user.type(rate, '175.50');
    await user.type(screen.getByLabelText(/Expected delivery date/), '2026-11-18');
    await user.click(screen.getByRole('button', { name: 'Supplier confirmed' }));
    expect(shop.transitionShopOrder).toHaveBeenCalledWith('o1', {
      to: 'SUPPLIER_CONFIRMED',
      expectedFrom: 'SUPPLIER_PENDING',
      lines: [{ itemId: 'i1', confirmedUnitCostPaise: 17550 }],
      delivery: { date: '2026-11-18', note: '' },
    });
  });

  it('when the customer asked for same day, the founder must decide before confirming', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('SUPPLIER_PENDING', { sameDayState: 'REQUESTED' }));
    vi.mocked(shop.transitionShopOrder).mockResolvedValue(detail('SUPPLIER_CONFIRMED'));
    openOrder();
    await user.click(await screen.findByRole('button', { name: 'Supplier confirmed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('choose whether it is possible');
    await user.click(screen.getByLabelText('Not possible today'));
    await user.click(screen.getByRole('button', { name: 'Supplier confirmed' }));
    expect(vi.mocked(shop.transitionShopOrder).mock.calls[0][1]).toMatchObject({ delivery: { sameDay: 'NOT_POSSIBLE' } });
  });

  it('supplier has none: cancels with a message and marks out of stock', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('SUPPLIER_PENDING'));
    vi.mocked(shop.transitionShopOrder).mockResolvedValue(detail('CANCELLED', { cancelledBy: 'FOUNDER', cancelReason: 'x' }));
    openOrder();
    await user.click(await screen.findByRole('button', { name: "Supplier doesn't have it…" }));
    await user.click(screen.getByRole('button', { name: 'Cancel order: supplier has none' }));
    expect(shop.transitionShopOrder).toHaveBeenCalledWith('o1', {
      to: 'CANCELLED', note: 'Sorry, the supplier is out of stock.', markOutOfStock: true, expectedFrom: 'SUPPLIER_PENDING',
    });
  });

  it('cash collected: a different amount needs a note', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('OUT_FOR_DELIVERY'));
    vi.mocked(shop.recordShopCod).mockResolvedValue(detail('DELIVERED', { paymentStatus: 'COLLECTED' }));
    openOrder();
    const amount = await screen.findByLabelText(/Cash collected \(₹\)/);
    expect(amount).toHaveValue('440');
    await user.clear(amount);
    await user.type(amount, '400');
    await user.click(screen.getByRole('button', { name: 'Delivered — cash collected' }));
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('different from the order total');
    expect(shop.recordShopCod).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Why is it different/), 'Rest tomorrow');
    await user.click(screen.getByRole('button', { name: 'Delivered — cash collected' }));
    expect(shop.recordShopCod).toHaveBeenCalledWith('o1', { amountPaise: 40000, mismatchNote: 'Rest tomorrow' });
  });

  it('out for delivery cannot be cancelled; delivery failed needs a reason', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('OUT_FOR_DELIVERY'));
    openOrder();
    await screen.findByRole('button', { name: 'Delivery failed' });
    expect(screen.queryByRole('button', { name: 'Cancel this order…' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delivery failed' }));
    expect(screen.getAllByRole('alert').some((a) => /at least 3 characters/.test(a.textContent ?? ''))).toBe(true);
    expect(shop.transitionShopOrder).not.toHaveBeenCalled();
  });

  it('a stale screen shows the server message', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.transitionShopOrder).mockRejectedValue(new Error('This order changed since you opened it (maybe on another device). Refresh and check again.'));
    openOrder();
    await user.click(await screen.findByRole('button', { name: "I've asked the supplier" }));
    expect(await screen.findByText(/changed since you opened it/)).toBeInTheDocument();
  });

  it('cofounder sees the order and profit but no action buttons', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'COFOUNDER', sections: ['founder'] });
    openOrder();
    expect(await screen.findByText(/Profit/)).toBeInTheDocument();
    expect(screen.getByText('Ravi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "I've asked the supplier" })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel this order…' })).not.toBeInTheDocument();
  });
});
