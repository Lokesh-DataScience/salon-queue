// frontend/src/components/admin/shop/ShopMoney.test.tsx — profit report, paying the supplier, expenses,
// phones & recovery (Commerce C5b).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopSection from './ShopSection';
import { renderPage } from '../../../test/utils';
import * as admin from '../../../api/admin';
import * as shop from '../../../api/shopAdmin';
import type { AdminOrderDetail, ShopReport } from '../../../api/shopAdmin';

vi.mock('../../../api/admin', () => ({ fetchAdminMe: vi.fn() }));
vi.mock('../../../api/shopAdmin', async (orig) => {
  const real = await orig<typeof import('../../../api/shopAdmin')>();
  return {
    ...real,
    fetchShopReport: vi.fn(),
    fetchPendingSettlement: vi.fn(),
    fetchSettlements: vi.fn(),
    recordSettlement: vi.fn(),
    fetchShopOrder: vi.fn(),
    fetchSupplierText: vi.fn(),
    addShopExpense: vi.fn(),
    voidShopExpense: vi.fn(),
    fetchShopCustomer: vi.fn(),
    createRecoveryCode: vi.fn(),
    revokeShopKey: vi.fn(),
  };
});

const report: ShopReport = {
  from: '2026-11-01', to: '2026-11-16', deliveredOrders: 2, cancelledOrders: 1, salesPaise: 66000, collectedPaise: 66000,
  supplierCostPaise: 53000, expensesPaise: 3000, refundsPaidPaise: 0, grossMarginPaise: 13000, netProfitPaise: 10000,
  owedToSupplierPaise: 18000, owedOrders: 1,
  orders: [
    { id: 'o1', orderNumber: 'SQ-1042', day: '2026-11-16', totalPaise: 44000, collectedPaise: 44000, costPaise: 35000, expensesPaise: 3000, profitPaise: 6000, settled: true },
    { id: 'o2', orderNumber: 'SQ-1043', day: '2026-11-16', totalPaise: 22000, collectedPaise: 22000, costPaise: 18000, expensesPaise: 0, profitPaise: 4000, settled: false },
  ],
};

function detail(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    order: {
      id: 'o1', orderNumber: 'SQ-1042', customerId: 'c1', status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'COLLECTED',
      createdAt: '2026-11-16T05:00:00Z', updatedAt: '2026-11-16T05:00:00Z', deliveredAt: '2026-11-16T09:00:00Z',
      customer: { name: 'Ravi', phone: '+919876543210', addressLine1: '12 Main Road', addressLine2: '', landmark: '', pincode: '' },
      subtotalPaise: 44000, deliveryFeePaise: 0, totalPaise: 44000, sameDayState: 'NOT_REQUESTED', expectedDeliveryDate: null,
      expectedDeliveryNote: '', cod: { collectedPaise: 44000, collectedAt: '2026-11-16T09:00:00Z', mismatchNote: '' },
      supplier: null, supplierContactedAt: null, fromSalon: false, cancelReason: null, cancelledBy: null, remindersSent: 0, supplierSettled: false,
    },
    items: [],
    finance: { costPaise: 35000, grossProfitPaise: 9000, costsConfirmed: true, expensesPaise: 0, netProfitPaise: 9000 },
    expenses: [],
    events: [],
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(admin.fetchAdminMe).mockReset().mockResolvedValue({ role: 'FOUNDER', sections: ['founder', 'sales', 'tech'] });
  vi.mocked(shop.fetchShopReport).mockReset().mockResolvedValue(report);
  vi.mocked(shop.fetchPendingSettlement).mockReset().mockResolvedValue({
    totalPayablePaise: 53000,
    orders: [
      { id: 'o1', orderNumber: 'SQ-1042', deliveredAt: '2026-11-16T09:00:00Z', totalPaise: 44000, supplierId: 's', supplierName: 'Sharma Traders', payablePaise: 35000 },
      { id: 'o2', orderNumber: 'SQ-1043', deliveredAt: '2026-11-16T10:00:00Z', totalPaise: 22000, supplierId: 's', supplierName: 'Sharma Traders', payablePaise: 18000 },
    ],
  });
  vi.mocked(shop.fetchSettlements).mockReset().mockResolvedValue({ settlements: [] });
  vi.mocked(shop.recordSettlement).mockReset().mockResolvedValue({ settlementId: 'st1', payablePaise: 35000, orderCount: 1 });
  vi.mocked(shop.fetchShopOrder).mockReset().mockResolvedValue(detail());
  vi.mocked(shop.addShopExpense).mockReset();
  vi.mocked(shop.fetchShopCustomer).mockReset().mockResolvedValue({
    customer: { id: 'c1', name: 'Ravi', phone: '+919876543210', addressLine1: '', addressLine2: '', landmark: '', pincode: '', phoneVerifiedAt: null, createdAt: '2026-11-01T00:00:00Z' },
    orders: [{ id: 'o1', orderNumber: 'SQ-1042', status: 'DELIVERED', createdAt: '2026-11-16T05:00:00Z' }],
    devices: [{ label: 'Phone 1', verifiedAt: null, verifiedBy: null, placedOrders: 1, keys: [{ id: 'k1', createdAt: '2026-11-01T00:00:00Z', lastSeenAt: '2026-11-16T00:00:00Z', revokedAt: null }] }],
    recoveryCodes: [],
  });
  vi.mocked(shop.createRecoveryCode).mockReset().mockResolvedValue({ code: '482 913', expiresAt: '2026-11-16T10:15:00Z' });
  vi.mocked(shop.revokeShopKey).mockReset();
});

const money = () => renderPage(<ShopSection />, { path: '/barber/admin', route: '/barber/admin?tab=shop&view=money' });
const order = () => renderPage(<ShopSection />, { path: '/barber/admin', route: '/barber/admin?tab=shop&view=orders&order=o1' });

describe('Money (founder)', () => {
  it('shows the profit figures and the delivered orders for the period', async () => {
    money();
    const report = await screen.findByRole('region', { name: 'Profit report' });
    expect(await within(report).findByText('Net profit')).toBeInTheDocument();
    const tile = (label: string) => within(within(report).getByText(label).parentElement!);
    expect(tile('Net profit').getByText('₹100')).toBeInTheDocument();
    expect(tile('Still owed to supplier').getByText('₹180')).toBeInTheDocument();
    expect(within(report).getByRole('button', { name: 'SQ-1043' })).toBeInTheDocument();
    expect(within(report).getAllByRole('row')).toHaveLength(3);
  });

  it('pays the ticked orders; the amount follows the ticks; a different amount needs a note', async () => {
    const user = userEvent.setup();
    money();
    const pay = await screen.findByRole('region', { name: 'Pay the supplier' });
    const amount = await within(pay).findByLabelText('Amount paid (₹)');
    expect(amount).toHaveValue('530');
    await user.click(within(pay).getByRole('checkbox', { name: /SQ-1043/ }));
    expect(amount).toHaveValue('350');
    await user.clear(amount);
    await user.type(amount, '340');
    await user.click(within(pay).getByRole('button', { name: 'Save payment to supplier' }));
    expect(within(pay).getByRole('alert')).toHaveTextContent('write a short note');
    expect(shop.recordSettlement).not.toHaveBeenCalled();
    await user.type(within(pay).getByLabelText('Why is it different?'), 'Rs 10 discount');
    await user.type(within(pay).getByLabelText(/Reference/), 'UTR9');
    await user.click(within(pay).getByRole('button', { name: 'Save payment to supplier' }));
    expect(vi.mocked(shop.recordSettlement).mock.calls[0][0]).toEqual({
      orderIds: ['o1'], amountPaise: 34000, method: 'UPI', reference: 'UTR9', note: 'Rs 10 discount',
    });
  });

  it('cofounder sees the figures and what is owed, with no payment form', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'COFOUNDER', sections: ['founder'] });
    money();
    const pay = await screen.findByRole('region', { name: 'Pay the supplier' });
    expect(await within(pay).findByText('SQ-1042')).toBeInTheDocument();
    expect(within(pay).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(pay).queryByRole('button', { name: 'Save payment to supplier' })).not.toBeInTheDocument();
  });
});

describe('Order: expenses and phones', () => {
  it('adds an expense', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.addShopExpense).mockResolvedValue(
      detail({
        finance: { costPaise: 35000, grossProfitPaise: 9000, costsConfirmed: true, expensesPaise: 3000, netProfitPaise: 6000 },
        expenses: [{ id: 'x1', kind: 'TRAVEL', amountPaise: 3000, note: 'Petrol', createdAt: '2026-11-16T09:00:00Z', voidedAt: null, voidReason: '' }],
      }),
    );
    order();
    await user.click(await screen.findByRole('button', { name: 'Add an expense…' }));
    await user.type(screen.getByLabelText('Amount (₹)'), '30');
    await user.type(screen.getByLabelText('Note (optional)'), 'Petrol');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(shop.addShopExpense).toHaveBeenCalledWith('o1', { kind: 'TRAVEL', amountPaise: 3000, note: 'Petrol' });
    expect(await screen.findByText(/After expenses/)).toHaveTextContent('₹60');
  });

  it('recovery code only after confirming the call; shown once', async () => {
    const user = userEvent.setup();
    order();
    await user.click(await screen.findByRole('button', { name: 'Phones & recovery…' }));
    const make = await screen.findByRole('button', { name: 'Make a recovery code' });
    expect(make).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /I have called \+919876543210/ }));
    await user.click(make);
    expect(shop.createRecoveryCode).toHaveBeenCalledWith('c1');
    expect(await screen.findByText('482 913')).toBeInTheDocument();
  });

  it('removing a lost phone asks to confirm first', async () => {
    const user = userEvent.setup();
    vi.mocked(shop.revokeShopKey).mockResolvedValue({ ...(await shop.fetchShopCustomer('c1')), devices: [] });
    order();
    await user.click(await screen.findByRole('button', { name: 'Phones & recovery…' }));
    await user.click(await screen.findByRole('button', { name: 'Remove access (lost phone)…' }));
    expect(shop.revokeShopKey).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, remove access' }));
    expect(shop.revokeShopKey).toHaveBeenCalledWith('c1', 'k1');
  });

  it('cofounder sees phones but cannot make codes or remove access', async () => {
    const user = userEvent.setup();
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'COFOUNDER', sections: ['founder'] });
    order();
    await user.click(await screen.findByRole('button', { name: 'Phones & recovery…' }));
    expect(await screen.findByText(/Phone 1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make a recovery code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove access/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an expense…' })).not.toBeInTheDocument();
  });
});
