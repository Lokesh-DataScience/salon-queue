// frontend/src/pages/BarberCustomers.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarberCustomers from './BarberCustomers';
import { renderPage } from '../test/utils';
import { ApiError } from '../api/client';
import * as barber from '../api/barber';

vi.mock('../api/barber', () => ({ fetchCustomers: vi.fn(), deleteCustomer: vi.fn() }));

const RAVI = { id: 'c1', name: 'Ravi Kumar', phone: '9876543210', firstVisitAt: '2026-10-01T05:00:00Z', lastVisitAt: '2026-11-08T05:00:00Z', visitCount: 3 };
const MEENA = { id: 'c2', name: 'Meena Iyer', phone: '9123456780', firstVisitAt: '2026-11-08T05:00:00Z', lastVisitAt: '2026-11-08T05:00:00Z', visitCount: 1 };
const renderList = () => renderPage(<BarberCustomers />, { path: '/barber/customers', route: '/barber/customers' });

beforeEach(() => {
  vi.mocked(barber.fetchCustomers).mockReset().mockResolvedValue([RAVI, MEENA]);
  vi.mocked(barber.deleteCustomer).mockReset().mockResolvedValue({ ok: true });
});

describe('Customers page', () => {
  it('lists name, tap-to-call phone, visit count and dates', async () => {
    renderList();
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('2 customers')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call 98765 43210' })).toHaveAttribute('href', 'tel:+919876543210');
    expect(screen.getByText(/3 visits · first 1 Oct 2026 · last 8 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByText(/1 visit ·/)).toBeInTheDocument();
  });

  it('searches after the typing pauses', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Ravi Kumar');
    vi.mocked(barber.fetchCustomers).mockResolvedValue([MEENA]);

    await user.type(screen.getByLabelText('Search by name or number'), 'meena');
    await waitFor(() => expect(barber.fetchCustomers).toHaveBeenLastCalledWith('meena'));
    expect(await screen.findByText('1 customer')).toBeInTheDocument();
    expect(screen.queryByText('Ravi Kumar')).not.toBeInTheDocument();
  });

  it('says so when there are no customers, and when a search finds none', async () => {
    vi.mocked(barber.fetchCustomers).mockResolvedValue([]);
    const user = userEvent.setup();
    renderList();
    expect(await screen.findByText(/No customers yet/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search by name or number'), 'zzz');
    expect(await screen.findByText('No one matches that search.')).toBeInTheDocument();
  });

  it('asks before deleting, and Cancel deletes nothing', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole('button', { name: 'Delete Ravi Kumar' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete Ravi Kumar?');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(barber.deleteCustomer).not.toHaveBeenCalled();
  });

  it('deletes the chosen customer after confirmation and refreshes the list', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole('button', { name: 'Delete Ravi Kumar' }));
    vi.mocked(barber.fetchCustomers).mockResolvedValue([MEENA]);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await waitFor(() => expect(barber.deleteCustomer).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.queryByText('Ravi Kumar')).not.toBeInTheDocument());
    expect(screen.getByText('Meena Iyer')).toBeInTheDocument();
  });

  it('shows the server message when a delete fails', async () => {
    vi.mocked(barber.deleteCustomer).mockRejectedValue(new ApiError('Customer not found.', 404));
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole('button', { name: 'Delete Meena Iyer' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Customer not found.');
  });

  it('tells a staff barber that only the owner can see the list', async () => {
    vi.mocked(barber.fetchCustomers).mockRejectedValue(new ApiError('Only the owner can do this.', 403));
    renderList();
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the salon owner can see the customer list.');
    expect(screen.queryByLabelText('Search by name or number')).not.toBeInTheDocument();
  });

  it('offers Try again when the list cannot load', async () => {
    vi.mocked(barber.fetchCustomers).mockRejectedValueOnce(new Error('network')).mockResolvedValue([RAVI]);
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
  });
});