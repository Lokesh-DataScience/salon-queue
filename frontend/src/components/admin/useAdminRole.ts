// frontend/src/components/admin/useAdminRole.ts
// The signed-in admin's role (same cached query as Settings and the Admin page).
// Only hides buttons: the server refuses Cofounder changes whatever the screen shows.
import { useQuery } from '@tanstack/react-query';
import { fetchAdminMe, type AdminRole } from '../../api/admin';

export function useAdminRole(): AdminRole | null {
  const { data } = useQuery({ queryKey: ['adminMe'], queryFn: fetchAdminMe, retry: false });
  return data?.role ?? null;
}

// Cofounder: sees every founder page, but salon and team changes are founder-only.
export function useFounderReadOnly() {
  return useAdminRole() === 'COFOUNDER';
}

export const FOUNDER_ONLY_NOTE = 'View only. Only the founder can change salons and admin access.';
