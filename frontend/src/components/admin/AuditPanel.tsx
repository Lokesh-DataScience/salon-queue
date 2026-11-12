// frontend/src/components/admin/AuditPanel.tsx
// Founder → Audit log: every admin action that changed something, newest first.
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchAudit, type AuditEntry, type AuditGroup } from '../../api/admin';

export const ACTION_LABEL: Record<string, string> = {
  'salon.create': 'Added a salon',
  'salon.suspend': 'Suspended a salon',
  'salon.unsuspend': 'Unsuspended a salon',
  'salon.mark_internal': 'Marked a salon internal',
  'salon.unmark_internal': 'Marked a salon as real',
  'salon.delete': 'Deleted a salon',
  'staff.password_reset': 'Reset a password',
  'sales.update_info': 'Edited sales notes',
  'sales.lead_create': 'Added a lead',
  'sales.lead_update': 'Updated a lead',
  'sales.lead_delete': 'Deleted a lead',
  'admin.grant': 'Gave admin access',
  'admin.revoke': 'Removed admin access',
};

const GROUPS: { id: AuditGroup | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'salon', label: 'Salons' },
  { id: 'staff', label: 'Passwords' },
  { id: 'sales', label: 'Sales' },
  { id: 'admin', label: 'Team' },
];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });

// A short "what" line from the safe details we store (names, roles — never passwords).
function summary(e: AuditEntry) {
  const d = e.details;
  const parts: string[] = [];
  if (typeof d.name === 'string') parts.push(d.name);
  if (typeof d.role === 'string') parts.push(`role ${String(d.role).toLowerCase()}`);
  if (d.isPartner === true) parts.push('marked partner');
  if (d.isPartner === false) parts.push('unmarked partner');
  if (d.notesChanged) parts.push('notes changed');
  if (d.salonMarkedInternal === true) parts.push('salon marked internal');
  if (typeof d.status === 'string' && typeof d.previousStatus === 'string') parts.push(`${d.previousStatus} → ${d.status}`);
  if (typeof d.linkedSalon === 'string') parts.push(`linked to ${d.linkedSalon}`);
  return parts.join(' · ');
}

export default function AuditPanel() {
  const [group, setGroup] = useState<AuditGroup | 'all'>('all');
  const q = useInfiniteQuery({
    queryKey: ['adminAudit', group],
    queryFn: ({ pageParam }) => fetchAudit({ group: group === 'all' ? undefined : group, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    retry: false,
  });
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}
            className={`min-h-11 rounded-xl px-3 text-sm ${
              group === g.id ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
            }`}>
            {g.label}
          </button>
        ))}
      </div>

      {q.isLoading && <p role="status" className="text-gray-600">Loading the audit log...</p>}
      {q.isError && !q.data && (
        <div className="card text-center">
          <p role="alert" className="mb-3 text-red-700">Couldn't load the audit log.</p>
          <button type="button" className="btn-secondary" onClick={() => q.refetch()}>Try again</button>
        </div>
      )}
      {q.data && entries.length === 0 && <p className="text-gray-600">Nothing here yet.</p>}

      {entries.length > 0 && (
        <ul aria-label="Audit log" className="card divide-y divide-gray-200 py-0">
          {entries.map((e) => (
            <li key={e.id} className="py-3">
              <p className="font-semibold">{ACTION_LABEL[e.action] ?? e.action}</p>
              {summary(e) && <p className="text-sm text-gray-700">{summary(e)}</p>}
              <p className="text-xs text-gray-600">
                {fmtWhen(e.at)} · by {e.actor.name} ({e.actor.role.toLowerCase()})
              </p>
            </li>
          ))}
        </ul>
      )}

      {q.hasNextPage && (
        <button type="button" className="btn-secondary" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          {q.isFetchingNextPage ? 'Loading...' : 'Load older'}
        </button>
      )}
    </div>
  );
}
