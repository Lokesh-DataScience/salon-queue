// The join flow's service picker shows prices when the salon set them (customer app polish, slice 2).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ServicePicker from './ServicePicker';

const services = [
  { id: 'a', name: 'Haircut', durationMinutes: 20, priceRupees: 100 },
  { id: 'b', name: 'Shave', durationMinutes: 10, priceRupees: 50 },
  { id: 'c', name: 'Massage', durationMinutes: 15, priceRupees: null },
];

describe('ServicePicker prices', () => {
  it('shows each price that is set', () => {
    render(<ServicePicker services={services} busy={false} onJoin={vi.fn()} />);
    expect(screen.getByText('₹100')).toBeInTheDocument();
    expect(screen.getByText('₹50')).toBeInTheDocument();
    expect(screen.getAllByText(/₹/)).toHaveLength(2);
  });

  it('adds up the price when every chosen service has one', async () => {
    const user = userEvent.setup();
    render(<ServicePicker services={services} busy={false} onJoin={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: /Haircut/ }));
    await user.click(screen.getByRole('checkbox', { name: /Shave/ }));
    expect(screen.getByRole('status')).toHaveTextContent('2 services · about 30 min · ₹150');
  });

  it('shows no total when a chosen service has no price', async () => {
    const user = userEvent.setup();
    render(<ServicePicker services={services} busy={false} onJoin={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: /Haircut/ }));
    await user.click(screen.getByRole('checkbox', { name: /Massage/ }));
    expect(screen.getByRole('status')).toHaveTextContent('2 services · about 35 min');
    expect(screen.getByRole('status')).not.toHaveTextContent('₹');
  });
});
