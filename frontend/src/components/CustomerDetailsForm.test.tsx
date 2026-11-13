// frontend/src/components/CustomerDetailsForm.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CustomerDetailsForm from './CustomerDetailsForm';
import { setLang } from '../lib/i18n';

// These tests check the English wording; the Hindi default has its own tests.
beforeEach(() => setLang('en'));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const nameInput = () => screen.getByLabelText('Your name') as HTMLInputElement;
const phoneInput = () => screen.getByLabelText('Mobile number') as HTMLInputElement;
const consentBox = () => screen.getByLabelText(/will save my name and number to its customer list/i) as HTMLInputElement;
const button = () => screen.getByRole('button') as HTMLButtonElement;

function fill(name: string, phone: string, consent: boolean) {
  fireEvent.change(nameInput(), { target: { value: name } });
  fireEvent.change(phoneInput(), { target: { value: phone } });
  if (consent !== consentBox().checked) fireEvent.click(consentBox());
}

describe('CustomerDetailsForm', () => {
  it('names the salon in the consent line', () => {
    render(<CustomerDetailsForm salonName="Milan Hair Salon" onSubmit={() => {}} />);
    expect(screen.getByText('Milan Hair Salon will save my name and number to its customer list.')).toBeTruthy();
  });

  it('stays disabled until name, a valid number and the consent tick are all there', () => {
    render(<CustomerDetailsForm salonName="Milan" onSubmit={() => {}} />);
    expect(button().disabled).toBe(true);
    expect(screen.getByText(/Still needed: your name, a 10-digit mobile number, the tick box/)).toBeTruthy();

    fill('Ravi', '', false);
    expect(button().disabled).toBe(true);
    fill('Ravi', '12345', false);
    expect(button().disabled).toBe(true);
    fill('Ravi', '98765 43210', false);
    expect(button().disabled).toBe(true); // no tick yet
    fill('   ', '98765 43210', true);
    expect(button().disabled).toBe(true); // blank name
    fill('Ravi', '98765 43210', true);
    expect(button().disabled).toBe(false);
  });

  it('shows a phone problem after the field is left, not while typing', () => {
    render(<CustomerDetailsForm onSubmit={() => {}} />);
    fireEvent.change(phoneInput(), { target: { value: '123' } });
    expect(screen.queryByText('Enter a valid 10-digit mobile number.')).toBeNull();
    fireEvent.blur(phoneInput());
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid 10-digit mobile number.');
    expect(phoneInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('hands over a tidy name and a normalised number, and nothing is written to storage', () => {
    const onSubmit = vi.fn();
    render(<CustomerDetailsForm salonName="Milan" submitLabel="Get my token" onSubmit={onSubmit} />);
    fill('  Ravi   Kumar ', '+91 98765-43210', true);
    fireEvent.click(screen.getByRole('button', { name: 'Get my token' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ravi Kumar', phone: '9876543210' });
    expect(localStorage.length).toBe(0);
  });

  it('cannot be submitted while busy, and shows a server error', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<CustomerDetailsForm onSubmit={onSubmit} />);
    fill('Ravi', '9876543210', true);
    rerender(<CustomerDetailsForm busy error="Salon is currently closed." onSubmit={onSubmit} />);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('Getting your token...');
    expect(screen.getByText('Salon is currently closed.')).toBeTruthy();
    fireEvent.submit(button().closest('form') as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});