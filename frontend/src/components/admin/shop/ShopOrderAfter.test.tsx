// frontend/src/components/admin/shop/ShopOrderAfter.test.tsx — stock decisions, returns and refunds (Commerce C6).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopSection from './ShopSection';
import { renderPage } from '../../../test/utils';
import * as admin from '../../../api/admin';
import * as shop from '../../../api/shopAdmin';
import type { AdminOrderDetail, AdminOrderStatus, OrderReturn } from '../../../api/shopAdmin';

vi.mock('../../../api/admin', () => ({ fetchAdminMe: vi.fn() }));
vi.mock('../../../api/shopAdmin', async (orig) => {
  const real = await orig<typeof import('../../../api/shopAdmin')>();
  return {
    ...real,
    fetchShopOrders: vi.fn(),
    fetchShopOrder: vi.fn(),
    disposeShopLine: vi.fn(),
    recordShopReturn: vi.fn(),
    resolveShopReturn: vi.fn(),
    markShopRefundPaid: vi.fn(),
  };
});

function detail(status: AdminOrderStatus, stockState: string, returns: OrderReturn[] = []): AdminOrderDetail {
  return {
    order: {
      id: 'o1', orderNumber: 'SQ-1042', customerId: 'c1', status, paymentMethod: 'COD', paymentStatus: status === 'DELIVERED' ? 'COLLECTED' : 'VOID',
      createdAt: '2026-11-16T05:00:00Z', updatedAt: '2026-11-16T05:00:00Z', deliveredAt: null,
      customer: { name: 'Ravi', phone: '+919876543210', addressLine1: '12 Main Road', addressLine2: '', landmark: '', pincode: '' },
      subtotalPaise: 66000, deliveryFeePaise: 0, totalPaise: 66000, sameDayState: 'NOT_REQUESTED', expectedDeliveryDate: null,
      expectedDeliveryNote: '', cod: { collectedPaise: status === 'DELIVERED' ? 66000 : null, collectedAt: null, mismatchNote: '' },
      supplier: null, supplierContactedAt: null, fromSalon: false, cancelReason: status === 'CANCELLED' ? 'Refused at the door' : null,
      cancelledBy: status === 'CANCELLED' ? 'FOUNDER' : null, remindersSent: 0, supplierSettled: false,
    },
    items: [
      {
        id: 'i1', productId: 'p1', productName: 'Beard Oil 50 ml', sku: 'BRD-50', mrpPaise: 25000, unitPricePaise: 22000, quantity: 3,
        lineTotalPaise: 66000, expectedUnitCostPaise: 18000, confirmedUnitCostPaise: 17500, stockState, lineProfitPaise: 13500,
        cancelRestockQty: 0, cancelWriteOffQty: 0, returnedQty: returns.reduce((n, r) => n + (r.status === 'REJECTED' ? 0 : r.quantity), 0), keptUnits: 3,
      },
    ],
    finance: { costPaise: 52500, grossProfitPaise: 13500, costsConfirmed: true, expensesPaise: 0, netProfitPaise: 13500 },
    expenses: [],
    returns,
    events: [],
  };
}
const received: OrderReturn = {
  id: 'r1', itemId: 'i1', quantity: 2, status: 'RECEIVED', restockQty: 0, writeOffQty: 0, reason: 'Wrong shade', decisionNote: '',
  refundPaise: 0, refundStatus: 'NONE', refundMethod: null, refundPaidAt: null, createdAt: '2026-11-16T09:00:00Z', resolvedAt: null,
};

beforeEach(() => {
  vi.mocked(admin.fetchAdminMe).mockReset().mockResolvedValue({ role: 'FOUNDER', sections: ['founder', 'sales', 'tech'] });
  vi.mocked(shop.fetchShopOrder).mockReset();
  vi.mocked(shop.disposeShopLine).mockReset().mockResolvedValue(detail('CANCELLED', 'CANCEL_SPLIT'));
  vi.mocked(shop.recordShopReturn).mockReset().mockResolvedValue(detail('DELIVERED', 'COMMITTED', [received]));
  vi.mocked(shop.resolveShopReturn).mockReset().mockResolvedValue(detail('DELIVERED', 'COMMITTED'));
  vi.mocked(shop.markShopRefundPaid).mockReset().mockResolvedValue(detail('DELIVERED', 'COMMITTED'));
  vi.mocked(shop.fetchShopOrders).mockReset().mockResolvedValue({
    counts: {},
    attention: { stockDecisions: 1, returns: 0, refunds: 1, total: 2 },
    orders: [
      {
        id: 'o1', orderNumber: 'SQ-1042', status: 'CANCELLED', paymentStatus: 'VOID', totalPaise: 66000, itemCount: 3,
        sameDayState: 'NOT_REQUESTED', expectedDeliveryDate: null, customerName: 'Ravi', pincode: '',
        createdAt: '2026-11-16T05:00:00Z', updatedAt: '2026-11-16T05:00:00Z', remindersSent: 0, needs: 'STOCK_DECISION',
      },
    ],
  });
});

const open = () => renderPage(<ShopSection />, { path: '/barber/admin', route: '/barber/admin?tab=shop&view=orders&order=o1' });

describe('After an order ends (founder)', () => {
  it('the list says which finished orders need you', async () => {
    renderPage(<ShopSection />, { path: '/barber/admin', route: '/barber/admin?tab=shop' });
    expect(await screen.findByText(/Finished orders need you/)).toHaveTextContent('1 stock decision · 1 refund to hand over');
    expect(screen.getByText('Stock decision')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs you (2)' })).toBeInTheDocument();
  });

  it('refused at the door: choose how many went back to the supplier; the rest is written off', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('CANCELLED', 'AWAITING_DISPOSITION'));
    open();
    const box = await screen.findByRole('region', { name: 'Stock decision' });
    const back = within(box).getByLabelText('Went back to the supplier (unopened)');
    expect(back).toHaveValue('3');
    expect(within(box).getByText(/Written off:/)).toHaveTextContent('Written off: 0');
    await user.selectOptions(back, '2');
    expect(within(box).getByText(/Written off:/)).toHaveTextContent('Written off: 1 — you pay the supplier ₹175');
    await user.click(within(box).getByRole('button', { name: 'Save stock decision' }));
    expect(shop.disposeShopLine).toHaveBeenCalledWith('o1', 'i1', { backToSupplierQty: 2, writeOffQty: 1, note: '' });
  });

  it('records a return with the customer reason', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('DELIVERED', 'COMMITTED'));
    open();
    await user.click(await screen.findByRole('button', { name: 'Customer gave something back…' }));
    await user.click(screen.getByRole('button', { name: 'Record the return' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Write the customer's reason");
    await user.selectOptions(screen.getByLabelText(/How many did they give back/), '2');
    await user.type(screen.getByLabelText(/Customer's reason/), 'Wrong shade');
    await user.click(screen.getByRole('button', { name: 'Record the return' }));
    expect(shop.recordShopReturn).toHaveBeenCalledWith('o1', 'i1', { quantity: 2, reason: 'Wrong shade' });
  });

  it('decides a return: back to supplier + written off + refund (starts at the price of the units)', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('DELIVERED', 'COMMITTED', [received]));
    open();
    const refund = await screen.findByLabelText(/Refund to the customer/);
    expect(refund).toHaveValue('440');
    await user.selectOptions(screen.getByLabelText('Went back to the supplier (unopened)'), '1');
    await user.click(screen.getByRole('button', { name: 'Save decision' }));
    expect(shop.resolveShopReturn).toHaveBeenCalledWith('r1', { decision: 'RESOLVED', backToSupplierQty: 1, writeOffQty: 1, refundPaise: 44000, note: '' });
  });

  it('not accepted needs a reason the customer will see', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('DELIVERED', 'COMMITTED', [received]));
    open();
    await user.click(await screen.findByLabelText(/Not accepted/));
    await user.click(screen.getByRole('button', { name: 'Save: not accepted' }));
    expect(screen.getByRole('alert')).toHaveTextContent('the customer sees this');
    await user.type(screen.getByLabelText(/Why not/), 'Opened and used');
    await user.click(screen.getByRole('button', { name: 'Save: not accepted' }));
    expect(shop.resolveShopReturn).toHaveBeenCalledWith('r1', { decision: 'REJECTED', backToSupplierQty: 0, writeOffQty: 0, refundPaise: 0, note: 'Opened and used' });
  });

  it('a pending refund is marked handed over with the method', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(
      detail('DELIVERED', 'COMMITTED', [{ ...received, status: 'RESOLVED', restockQty: 2, refundPaise: 44000, refundStatus: 'PENDING', resolvedAt: '2026-11-16T10:00:00Z' }]),
    );
    open();
    expect(await screen.findByText('Refund ₹440 to hand over')).toBeInTheDocument();
    await user.click(screen.getByLabelText('UPI'));
    await user.click(screen.getByRole('button', { name: "I've handed over the ₹440 refund" }));
    expect(shop.markShopRefundPaid).toHaveBeenCalledWith('r1', 'UPI');
  });

  it('cofounder sees returns but no decision or refund buttons', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'COFOUNDER', sections: ['founder'] });
    vi.mocked(shop.fetchShopOrder).mockResolvedValue(detail('DELIVERED', 'COMMITTED', [received]));
    open();
    expect(await screen.findByText(/Customer's reason: Wrong shade/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customer gave something back…' })).not.toBeInTheDocument();
  });
});
