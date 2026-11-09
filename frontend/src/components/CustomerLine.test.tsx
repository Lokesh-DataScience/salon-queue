// frontend/src/components/CustomerLine.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CustomerLine from './CustomerLine';

describe('CustomerLine', () => {
  it('shows the name and a tap-to-call link', () => {
    render(<CustomerLine name="Ravi Kumar" phone="9876543210" />);
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Call 98765 43210' });
    expect(link).toHaveAttribute('href', 'tel:+919876543210');
  });

  it('says so when no details are saved (walk-in, or the customer was removed)', () => {
    render(<CustomerLine name={null} phone={null} />);
    expect(screen.getByText('No details saved')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});