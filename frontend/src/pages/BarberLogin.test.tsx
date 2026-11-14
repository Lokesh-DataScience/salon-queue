// frontend/src/pages/BarberLogin.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BarberLogin from './BarberLogin';
import { loginBarber } from '../api/barber';
import { ApiError } from '../api/client';
import { resetLangForTests, setLang } from '../lib/i18n';

vi.mock('../api/barber', () => ({ loginBarber: vi.fn() }));

function renderPage(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/barber/login', state }]}>
      <Routes>
        <Route path="/barber/login" element={<BarberLogin />} />
        <Route path="/barber/dashboard" element={<p>DASHBOARD</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetLangForTests();
  vi.mocked(loginBarber).mockResolvedValue({ staff: {} } as never);
});

describe('BarberLogin — language', () => {
  it('opens in Hindi with a mobile number field and switches to English', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'लॉगिन करें' })).toBeInTheDocument();
    expect(screen.getByLabelText('मोबाइल नंबर')).toHaveAttribute('type', 'tel');
    act(() => setLang('en'));
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
  });
});

describe('BarberLogin (English)', () => {
  beforeEach(() => setLang('en'));

  it('signs in with the mobile number and opens the dashboard', async () => {
    renderPage();
    type('Mobile number', '+91 98765-43210');
    type('Password', '123456');
    submit();
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
    expect(loginBarber).toHaveBeenCalledWith('9876543210', '123456');
  });

  it('checks the number before sending', () => {
    renderPage();
    type('Mobile number', '12345');
    type('Password', '123456');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid 10-digit mobile number.');
    expect(loginBarber).not.toHaveBeenCalled();
  });

  it('shows a plain message for a wrong number or password', async () => {
    vi.mocked(loginBarber).mockRejectedValue(new ApiError('Invalid email, phone number or password.', 401));
    renderPage();
    type('Mobile number', '9876543210');
    type('Password', 'wrong1');
    submit();
    expect(await screen.findByText('Wrong mobile number or password.')).toBeInTheDocument();
  });

  it('lets an older account sign in with email', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Older account? Sign in with email' }));
    type('Email', 'Owner@Example.com');
    type('Password', 'oldpassword');
    submit();
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
    expect(loginBarber).toHaveBeenCalledWith('owner@example.com', 'oldpassword');
  });

  it('shows the server reason for a switched-off account', async () => {
    vi.mocked(loginBarber).mockRejectedValue(
      new ApiError('This account has been switched off. Please contact your salon owner.', 403),
    );
    renderPage();
    type('Mobile number', '9876543210');
    type('Password', '123456');
    submit();
    expect(await screen.findByText(/switched off/)).toBeInTheDocument();
  });

  it('asks to sign in again after a session ends', () => {
    renderPage({ expired: true });
    expect(screen.getByText('Please sign in to continue.')).toBeInTheDocument();
  });
});