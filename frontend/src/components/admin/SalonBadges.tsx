// frontend/src/components/admin/SalonBadges.tsx
import type { AdminSalonSummary } from '../../api/admin';

// Text labels, never colour alone.
export default function SalonBadges({ s }: { s: Pick<AdminSalonSummary, 'isInternal' | 'isSuspended'> }) {
  return (
    <>
      {s.isSuspended && (
        <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-800">Suspended</span>
      )}
      {s.isInternal && (
        <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700">Internal</span>
      )}
    </>
  );
}
