// frontend/src/components/ChangePasswordForm.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangePasswordForm from './ChangePasswordForm';
import { ApiError } from '../api/client';
import * as barber from '../api/barber';

vi.mock('../api/barber', () => ({ changePassword: vi.fn() }));

beforeEach(() => {
  vi.mocked(barber.changePassword).mockReset();
});

async function fill(user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm: string) {
  await user.type(screen.getByLabelText(/current password/i), current);
  await user.type(screen.getByLabelText(/^new password/i), next);
  await user.type(screen.getByLabelText(/confirm new password/i), confirm);
  await user.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('ChangePasswordForm', () => {
  it('blocks mismatched, short and unchanged passwords without calling the server', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm />);

    await fill(user, 'oldpass-12345', 'brand-new-pass-99', 'something-else-1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);

    await user.clear(screen.getByLabelText(/^new password/i));
    await user.type(screen.getByLabelText(/^new password/i), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 10/i);

    await user.clear(screen.getByLabelText(/^new password/i));
    await user.type(screen.getByLabelText(/^new password/i), 'oldpass-12345');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/different/i);

    expect(barber.changePassword).not.toHaveBeenCalled();
  });

  it('changes the password and clears the fields', async () => {
    vi.mocked(barber.changePassword).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ChangePasswordForm />);

    await fill(user, 'oldpass-12345', 'brand-new-pass-99', 'brand-new-pass-99');

    expect(barber.changePassword).toHaveBeenCalledWith('oldpass-12345', 'brand-new-pass-99');
    expect(await screen.findByRole('status')).toHaveTextContent(/password changed/i);
    expect(screen.getByLabelText(/current password/i)).toHaveValue('');
    expect(screen.getByLabelText(/^new password/i)).toHaveValue('');
  });

  it('shows the server reason and keeps what was typed so the barber can retry', async () => {
    vi.mocked(barber.changePassword).mockImplementation(() =>
    Promise.reject(new ApiError('Your current password is incorrect.', 400)),
    );
    const user = userEvent.setup();
    render(<ChangePasswordForm />);

    await fill(user, 'wrong-password-1', 'brand-new-pass-99', 'brand-new-pass-99');

    expect(await screen.findByRole('alert')).toHaveTextContent(/current password is incorrect/i);
    expect(screen.getByLabelText(/^new password/i)).toHaveValue('brand-new-pass-99');
  });
});