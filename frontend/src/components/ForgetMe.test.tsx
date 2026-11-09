// frontend/src/components/ForgetMe.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ForgetMe from './ForgetMe';
import { forgetMyDetails } from '../api/tickets';
import { ApiError } from '../api/client';
import { getRememberToken, saveRememberToken } from '../lib/rememberToken';

vi.mock('../api/tickets', () => ({ forgetMyDetails: vi.fn() }));
const forget = vi.mocked(forgetMyDetails);

const TOKEN = 'c'.repeat(64);
afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  forget.mockReset();
  saveRememberToken('salon-1', TOKEN);
});

const open = () => {
  render(<ForgetMe ticketId="t1" accessToken={'x'.repeat(40)} salonId="salon-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove my details from this salon' }));
};

describe('ForgetMe', () => {
  it('asks first, and Keep changes nothing', () => {
    open();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(forget).not.toHaveBeenCalled();
    expect(getRememberToken('salon-1')).toBe(TOKEN);
    expect(screen.getByRole('button', { name: 'Remove my details from this salon' })).toBeTruthy();
  });

  it('removes the details, forgets this salon\'s token and says so', async () => {
    forget.mockResolvedValue({ ok: true });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no longer saved at this salon/));
    expect(forget).toHaveBeenCalledWith('t1', 'x'.repeat(40));
    expect(getRememberToken('salon-1')).toBeNull();
  });

  it('treats "nothing saved here" (404) as done', async () => {
    forget.mockRejectedValue(new ApiError('Ticket not found or access denied.', 404));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(getRememberToken('salon-1')).toBeNull();
  });

  it('keeps the token and shows an error when the request fails', async () => {
    forget.mockRejectedValue(new Error('offline'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not remove/i));
    expect(getRememberToken('salon-1')).toBe(TOKEN);
    expect(screen.getByRole('button', { name: 'Yes, remove' })).toBeTruthy(); // can try again
  });
});