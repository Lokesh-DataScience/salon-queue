// frontend/src/components/admin/TeamPanel.tsx
// Founder → Team: who has admin access; give or remove Cofounder / Sales / Tech access.
// Founder access itself is only changed in Supabase, and you can't change your own.
// A Cofounder sees the list only.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchTeam, grantAdminRole, revokeAdminRole, type TeamMember } from '../../api/admin';
import { FOUNDER_ONLY_NOTE, useFounderReadOnly } from './useAdminRole';

const ROLE_LABEL = { FOUNDER: 'Founder', COFOUNDER: 'Cofounder', SALES: 'Sales', TECH: 'Tech' } as const;
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

function MemberRow({ m, readOnly }: { m: TeamMember; readOnly: boolean }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => revokeAdminRole(m.staffId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adminTeam'] }),
  });
  const locked = readOnly || m.isYou || m.role === 'FOUNDER';

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{m.name ?? 'Unknown account'}</span>
        <span className="rounded-full border border-ink bg-brand px-2 py-0.5 text-xs font-bold text-ink">{ROLE_LABEL[m.role]}</span>
        {m.isYou && <span className="text-xs text-gray-600">(you)</span>}
      </div>
      <p className="text-sm text-gray-700">{m.email ?? m.phone ?? '—'}</p>
      <p className="text-xs text-gray-600">
        {m.salonName ? `Salon: ${m.salonName}${m.salonIsInternal ? ' (internal)' : ''} · ` : ''}since {fmtDate(m.grantedAt)}
        {m.note ? ` · ${m.note}` : ''}
      </p>
      {remove.isError && <p role="alert" className="mt-1 text-sm text-red-700">{errText(remove.error)}</p>}
      {!locked &&
        (confirm ? (
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary min-h-11 flex-1 bg-red-700" disabled={remove.isPending}
              onClick={() => remove.mutate()}>
              {remove.isPending ? 'Removing...' : `Yes, remove ${m.name ?? 'access'}`}
            </button>
            <button type="button" className="btn-secondary min-h-11 px-4" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="btn-secondary mt-2 min-h-11 px-3 text-sm" onClick={() => setConfirm(true)}
            aria-label={`Remove admin access for ${m.name ?? 'this account'}`}>
            Remove access
          </button>
        ))}
    </li>
  );
}

function GrantForm() {
  const qc = useQueryClient();
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState<'COFOUNDER' | 'SALES' | 'TECH'>('SALES');
  const [markSalonInternal, setMarkSalonInternal] = useState(true);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => grantAdminRole({ identifier: identifier.trim(), role, markSalonInternal, note: note.trim() || undefined }),
    onSuccess: async () => {
      setIdentifier('');
      setNote('');
      await qc.invalidateQueries({ queryKey: ['adminTeam'] });
    },
  });

  return (
    <form className="card grid gap-3" aria-label="Give admin access" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <h3 className="text-base font-semibold">Give admin access</h3>
      <p className="text-sm text-gray-600">The person registers a salon first, like any barber. Then enter the email or phone they sign in with.</p>
      <div>
        <label htmlFor="grant-id" className="mb-1 block text-sm font-medium">Their email or phone</label>
        <input id="grant-id" className="field" required autoComplete="off" value={identifier}
          onChange={(e) => setIdentifier(e.target.value)} />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Access</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(['SALES', 'TECH', 'COFOUNDER'] as const).map((r) => (
            <label key={r} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-3 ${role === r ? 'border-ink bg-brand font-bold' : 'border-gray-300'}`}>
              <input type="radio" name="grant-role" value={r} checked={role === r} onChange={() => setRole(r)} className="h-5 w-5" />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
        {role === 'COFOUNDER' && (
          <p className="mt-2 text-sm text-gray-700">
            Sees every admin page and can use Sales and Tech, but can't change salons or admin access.
          </p>
        )}
      </fieldset>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" className="h-5 w-5" checked={markSalonInternal} onChange={(e) => setMarkSalonInternal(e.target.checked)} />
        <span>Mark their salon as internal (left out of the numbers)</span>
      </label>
      <div>
        <label htmlFor="grant-note" className="mb-1 block text-sm font-medium">Note (optional)</label>
        <input id="grant-note" className="field" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. sales partner, Korba" />
      </div>
      {m.isError && <p role="alert" className="text-sm text-red-700">{errText(m.error)}</p>}
      {m.isSuccess && <p role="status" className="text-sm font-semibold text-green-800">Done. They'll see Admin in Settings now.</p>}
      <button type="submit" className="btn-primary" disabled={m.isPending}>{m.isPending ? 'Saving...' : 'Give access'}</button>
    </form>
  );
}

export default function TeamPanel() {
  const readOnly = useFounderReadOnly();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['adminTeam'], queryFn: fetchTeam, retry: false });

  return (
    <div className="grid gap-4">
      <section aria-label="Admins" className="card">
        <h3 className="mb-1 text-base font-semibold">People with admin access</h3>
        {isLoading && <p role="status" className="text-gray-600">Loading...</p>}
        {isError && (
          <div>
            <p role="alert" className="mb-2 text-red-700">Couldn't load the team.</p>
            <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
          </div>
        )}
        {data && (
          <ul className="divide-y divide-gray-200">
            {data.map((m) => <MemberRow key={m.staffId} m={m} readOnly={readOnly} />)}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-600">
          {readOnly ? FOUNDER_ONLY_NOTE : 'Founder access can only be given or removed in Supabase.'}
        </p>
      </section>
      {!readOnly && <GrantForm />}
    </div>
  );
}
