// frontend/src/components/BarberAlertsSwitch.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BarberAlertsSwitch from './BarberAlertsSwitch';
import * as lib from '../lib/barberPush';

vi.mock('../lib/barberPush', () => ({
  getBarberAlertsState: vi.fn(),
  enableBarberAlerts: vi.fn(),
  disableBarberAlerts: vi.fn(),
  sendBarberTestAlert: vi.fn(),
}));

const m = vi.mocked(lib);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BarberAlertsSwitch', () => {
  it('off → tap → on, and the test button appears', async () => {
    m.getBarberAlertsState.mockResolvedValue('off');
    m.enableBarberAlerts.mockResolvedValue('on');
    render(<BarberAlertsSwitch />);

    const sw = await screen.findByRole('switch', { name: 'New customer alerts' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: 'Send test alert' })).toBeNull();

    fireEvent.click(sw);
    expect(m.enableBarberAlerts).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('button', { name: 'Send test alert' })).toBeInTheDocument();
  });

  it('on → tap → off', async () => {
    m.getBarberAlertsState.mockResolvedValue('on');
    m.disableBarberAlerts.mockResolvedValue(undefined);
    render(<BarberAlertsSwitch />);

    const sw = await screen.findByRole('switch', { name: 'New customer alerts' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(m.disableBarberAlerts).toHaveBeenCalledTimes(1);
  });

  it('permission denied while turning on shows how to unblock, no switch', async () => {
    m.getBarberAlertsState.mockResolvedValue('off');
    m.enableBarberAlerts.mockResolvedValue('blocked');
    render(<BarberAlertsSwitch />);

    fireEvent.click(await screen.findByRole('switch'));
    expect(await screen.findByText(/Alerts are blocked/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('prompt dismissed: stays off with a hint', async () => {
    m.getBarberAlertsState.mockResolvedValue('off');
    m.enableBarberAlerts.mockResolvedValue('dismissed');
    render(<BarberAlertsSwitch />);

    const sw = await screen.findByRole('switch');
    fireEvent.click(sw);
    expect(await screen.findByRole('alert')).toHaveTextContent(/choose Allow/);
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('unsupported phone: explanation only', async () => {
    m.getBarberAlertsState.mockResolvedValue('unsupported');
    render(<BarberAlertsSwitch />);
    expect(await screen.findByText(/can't show alerts/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('test alert: success note, then server error message', async () => {
    m.getBarberAlertsState.mockResolvedValue('on');
    m.sendBarberTestAlert.mockResolvedValueOnce({ ok: true, sent: 1 });
    m.sendBarberTestAlert.mockRejectedValueOnce(new Error('Please wait a little before sending another test.'));
    render(<BarberAlertsSwitch />);

    const btn = await screen.findByRole('button', { name: 'Send test alert' });
    fireEvent.click(btn);
    expect(await screen.findByRole('status')).toHaveTextContent(/Test sent/);

    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a little/);
  });
});
