// frontend/src/components/admin/OnboardingPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OnboardingPanel from './OnboardingPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { OnboardingFunnel, OnboardingSalon } from '../../api/admin';

vi.mock('../../api/admin', () => ({ fetchSalesOnboarding: vi.fn() }));

const salon = (over: Partial<OnboardingSalon>): OnboardingSalon => ({
  id: 'x', name: 'Salon', area: 'Korba, Chhattisgarh', createdAt: '2026-11-01T06:00:00Z', isSuspended: false,
  owner: { name: 'Owner', phone: '9876543210', email: null },
  reached: { services: true, first_ticket: true, first_qr: true, active: true },
  eligibleForActive: true, nextStep: null, ...over,
});

const funnel: OnboardingFunnel = {
  period: '30',
  registered: 4,
  steps: [
    { id: 'services', label: 'Added services', count: 3, outOf: 4 },
    { id: 'first_ticket', label: 'First ticket (walk-in or QR)', count: 2, outOf: 4 },
    { id: 'first_qr', label: 'First customer QR scan', count: 1, outOf: 4 },
    { id: 'active', label: 'Still active (ticket in the last 7 days)', count: 1, outOf: 3 },
  ],
  medianDaysToFirstTicket: 1.5,
  salons: [
    salon({ id: 'a', name: 'No Services Salon', nextStep: 'services' }),
    salon({ id: 'b', name: 'Walk-in Only Salon', nextStep: 'first_qr' }),
    salon({ id: 'c', name: 'Happy Salon' }),
  ],
};

const renderIt = () => renderPage(<OnboardingPanel />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchSalesOnboarding).mockReset().mockResolvedValue(funnel);
});

describe('OnboardingPanel', () => {
  it('shows each step as "n of m · %" with the typical time to first ticket', async () => {
    renderIt();
    const f = await screen.findByRole('region', { name: 'Funnel' });
    expect(within(f).getByText('4 of 4 · 100%')).toBeInTheDocument();
    expect(within(f).getByText('3 of 4 · 75%')).toBeInTheDocument();
    expect(within(f).getByText('1 of 3 · 33%')).toBeInTheDocument();
    expect(within(f).getByText(/only counts salons registered at least 7 days ago/i)).toBeInTheDocument();
    expect(within(f).getByText('1.5 days')).toBeInTheDocument();
  });

  it('groups stuck salons by the step they are missing, with a call link', async () => {
    renderIt();
    const group = (await screen.findByText('Have not added services')).closest('details')!;
    expect(within(group).getByText('No Services Salon')).toBeInTheDocument();
    expect(within(group).getByRole('link', { name: '9876543210' })).toHaveAttribute('href', 'tel:9876543210');
    const qr = screen.getByText('Walk-ins only, no QR scans').closest('details')!;
    expect(within(qr).getByText('Walk-in Only Salon')).toBeInTheDocument();
    expect(screen.queryByText('Happy Salon')).not.toBeInTheDocument();
  });

  it('changes the period', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('region', { name: 'Funnel' });
    await user.click(screen.getByRole('button', { name: 'All time' }));
    expect(admin.fetchSalesOnboarding).toHaveBeenLastCalledWith('all');
  });
});
