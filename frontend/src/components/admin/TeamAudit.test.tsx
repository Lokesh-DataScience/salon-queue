// frontend/src/components/admin/TeamAudit.test.tsx — Slice 3
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamPanel from './TeamPanel';
import AuditPanel from './AuditPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { TeamMember } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  fetchAdminMe: vi.fn(),
  fetchTeam: vi.fn(),
  grantAdminRole: vi.fn(),
  revokeAdminRole: vi.fn(),
  fetchAudit: vi.fn(),
}));

const me: TeamMember = {
  staffId: 'f1', role: 'FOUNDER', grantedAt: '2026-11-12T08:00:00Z', note: null, name: 'Lokesh',
  email: 'me@example.com', phone: null, salonId: 's1', salonName: 'My Test Salon', salonIsInternal: true, isYou: true,
};
const partner: TeamMember = {
  ...me, staffId: 'p1', role: 'SALES', name: 'Partner', email: 'partner@example.com', note: 'sales partner', isYou: false,
  salonName: 'Partner Salon',
};

const render = (ui: React.ReactElement) => renderPage(ui, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchAdminMe).mockReset().mockResolvedValue({ role: 'FOUNDER', sections: ['founder', 'sales', 'tech'] });
  vi.mocked(admin.fetchTeam).mockReset().mockResolvedValue([me, partner]);
  vi.mocked(admin.grantAdminRole).mockReset().mockResolvedValue({ staffId: 'x', role: 'TECH' });
  vi.mocked(admin.revokeAdminRole).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(admin.fetchAudit).mockReset().mockResolvedValue({
    entries: [
      { id: 2, at: '2026-11-12T10:00:00Z', action: 'admin.grant', actor: { name: 'Lokesh', email: 'me@example.com', role: 'FOUNDER' },
        targetType: 'staff', targetId: 'p1', details: { name: 'Partner', role: 'SALES' } },
      { id: 1, at: '2026-11-12T09:00:00Z', action: 'salon.suspend', actor: { name: 'Lokesh', email: null, role: 'FOUNDER' },
        targetType: 'salon', targetId: 's9', details: { name: 'Milan Hair Salon' } },
    ],
    nextBefore: 1,
  });
});

describe('TeamPanel', () => {
  it('lists admins; you and founders cannot be removed here', async () => {
    render(<TeamPanel />);
    const list = await screen.findByRole('region', { name: 'Admins' });
    expect(await within(list).findByText('Partner')).toBeInTheDocument();
    expect(within(list).getByText('(you)')).toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: /remove admin access/i })).toHaveLength(1);
  });

  it('removes access only after a second tap', async () => {
    const user = userEvent.setup();
    render(<TeamPanel />);
    await user.click(await screen.findByRole('button', { name: 'Remove admin access for Partner' }));
    expect(admin.revokeAdminRole).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, remove Partner' }));
    expect(admin.revokeAdminRole).toHaveBeenCalledWith('p1');
  });

  it('gives Tech access with the salon marked internal by default', async () => {
    const user = userEvent.setup();
    render(<TeamPanel />);
    await user.type(await screen.findByLabelText('Their email or phone'), ' new@example.com ');
    await user.click(screen.getByRole('radio', { name: 'Tech' }));
    await user.click(screen.getByRole('button', { name: 'Give access' }));
    expect(admin.grantAdminRole).toHaveBeenCalledWith({
      identifier: 'new@example.com', role: 'TECH', markSalonInternal: true, note: undefined,
    });
    expect(await screen.findByText(/they'll see admin in settings/i)).toBeInTheDocument();
  });
});

describe('AuditPanel', () => {
  it('shows actions in plain words, filters by group and loads older', async () => {
    const user = userEvent.setup();
    render(<AuditPanel />);
    const list = await screen.findByRole('list', { name: 'Audit log' });
    expect(within(list).getByText('Gave admin access')).toBeInTheDocument();
    expect(within(list).getByText('Partner · role sales')).toBeInTheDocument();
    expect(within(list).getByText('Suspended a salon')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load older' }));
    expect(admin.fetchAudit).toHaveBeenLastCalledWith({ group: undefined, before: 1 });

    await user.click(screen.getByRole('button', { name: 'Team' }));
    expect(admin.fetchAudit).toHaveBeenLastCalledWith({ group: 'admin', before: undefined });
  });
});

describe('TeamPanel as Cofounder', () => {
  it('shows the team but cannot give or remove access', async () => {
    vi.mocked(admin.fetchAdminMe).mockResolvedValue({ role: 'COFOUNDER', sections: ['founder', 'sales', 'tech'] });
    vi.mocked(admin.fetchTeam).mockResolvedValue([{ ...me, isYou: false }, partner, { ...partner, staffId: 'c1', role: 'COFOUNDER', name: 'Co', isYou: true }]);
    render(<TeamPanel />);
    const list = await screen.findByRole('region', { name: 'Admins' });
    expect(await within(list).findByText('Cofounder')).toBeInTheDocument();
    expect(await screen.findByText(/view only/i)).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /remove admin access/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Give admin access' })).not.toBeInTheDocument();
  });

  it('the founder can give Cofounder access', async () => {
    const user = userEvent.setup();
    render(<TeamPanel />);
    await user.type(await screen.findByLabelText('Their email or phone'), 'co@example.com');
    await user.click(screen.getByRole('radio', { name: 'Cofounder' }));
    expect(screen.getByText(/can't change salons or admin access/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Give access' }));
    expect(admin.grantAdminRole).toHaveBeenCalledWith({ identifier: 'co@example.com', role: 'COFOUNDER', markSalonInternal: true, note: undefined });
  });
});
