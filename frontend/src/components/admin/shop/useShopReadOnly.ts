// frontend/src/components/admin/shop/useShopReadOnly.ts
// Cofounder (and anyone not FOUNDER) sees the Shop tab read-only. Cosmetic: the server refuses their changes anyway.
import { useAdminRole } from '../useAdminRole';

export const SHOP_READ_ONLY_NOTE = 'View only. Only the founder can change products, stock and shop settings.';

export function useShopReadOnly() {
  return useAdminRole() !== 'FOUNDER';
}
