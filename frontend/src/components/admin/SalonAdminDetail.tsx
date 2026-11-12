// frontend/src/components/admin/SalonAdminDetail.tsx
// One salon, for the founder: suspend, mark internal, reset a staff password, delete (internal only).
// A Cofounder sees the same details with no action buttons.
// Every risky action asks for a second, explicit tap — no browser pop-ups.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteAdminSalon,
  fetchAdminSalon,
  resetStaffPassword,
  setSalonInternal,
  setSalonSuspended,
  type AdminStaff,
} from '../../api/admin';
import SalonBadges from './SalonBadges';
import { FOUNDER_ONLY_NOTE, useFounderReadOnly } from './useAdminRole';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

function ResetPassword({ member }: { member: AdminStaff }) {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [founderPassword, setFounderPassword] = useState('');
  const m = useMutation({
    mutationFn: () => resetStaffPassword(member.id, founderPassword, newPassword),
    onSuccess: () => {
      setNewPassword('');
      setFounderPassword('');
    },
  });

  if (!open) {
    return (
      <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => setOpen(true)}>
        Reset password
      </button>
    );
  }

  const idNew = `np-${member.id}`;
  const idMine = `fp-${member.id}`;
  return (
    <form
      className="mt-2 grid gap-2 rounded-xl border-2 border-gray-200 p-3"
      aria-label={`Reset password for ${member.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <label htmlFor={idNew} className="text-sm font-medium">New password for {member.name}</label>
      <input id={idNew} type="text" className="field" minLength={8} required value={newPassword}
        autoComplete="off" onChange={(e) => setNewPassword(e.target.value)} />
      <label htmlFor={idMine} className="text-sm font-medium">Your password (to confirm it's you)</label>
      <input id={idMine} type="password" className="field" required value={founderPassword}
        autoComplete="current-password" onChange={(e) => setFounderPassword(e.target.value)} />
      <p className="text-xs text-gray-600">They will be signed out on every phone and must use the new password.</p>
      {m.isError && <p role="alert" className="text-sm text-red-700">{errText(m.error)}</p>}
      {m.isSuccess && <p role="status" className="text-sm font-semibold text-green-800">Password changed. Tell {member.name} the new one.</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-11 flex-1" disabled={m.isPending}>
          {m.isPending ? 'Saving...' : 'Set new password'}
        </button>
        <button type="button" className="btn-secondary min-h-11 px-4" onClick={() => { setOpen(false); m.reset(); }}>
          Close
        </button>
      </div>
    </form>
  );
}

export default function SalonAdminDetail({ salonId, onBack }: { salonId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: s, isLoading, isError, refetch } = useQuery({
    queryKey: ['adminSalon', salonId],
    queryFn: () => fetchAdminSalon(salonId),
    retry: false,
  });
  const readOnly = useFounderReadOnly();
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [deleteName, setDeleteName] = useState('');

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['adminSalon', salonId] });
    await qc.invalidateQueries({ queryKey: ['adminSalons'] });
  };

  const suspend = useMutation({
    mutationFn: (v: boolean) => setSalonSuspended(salonId, v),
    onSuccess: async () => {
      setConfirmSuspend(false);
      await refresh();
    },
  });
  const internal = useMutation({ mutationFn: (v: boolean) => setSalonInternal(salonId, v), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => deleteAdminSalon(salonId, deleteName),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['adminSalons'] });
      onBack();
    },
  });

  const back = (
    <button type="button" onClick={onBack} className="mb-2 justify-self-start text-sm font-semibold text-gray-700 underline">
      ‹ All salons
    </button>
  );

  if (isLoading) return <div className="grid">{back}<p role="status" className="text-gray-600">Loading salon...</p></div>;
  if (isError || !s) {
    return (
      <div className="grid">
        {back}
        <p role="alert" className="text-red-700">Couldn't load this salon.</p>
        <button type="button" className="btn-secondary mt-3" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {back}
      <section aria-label="Salon" className="card">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-bold">{s.name}</h3>
          <SalonBadges s={s} />
        </div>
        <p className="mt-1 text-sm text-gray-700">{s.address}</p>
        <p className="text-sm text-gray-700">Salon phone: {s.phone}</p>
        {readOnly && <p className="mt-2 text-sm font-semibold text-gray-700">{FOUNDER_ONLY_NOTE}</p>}
      </section>

      <section aria-label="Staff accounts" className="card">
        <h3 className="mb-2 text-base font-semibold">Staff accounts</h3>
        <ul className="divide-y divide-gray-200">
          {s.staff.map((m) => (
            <li key={m.id} className="py-3">
              <p className="font-semibold">
                {m.name} <span className="text-sm font-normal text-gray-600">({m.role.toLowerCase()}{m.isActive ? '' : ', switched off'})</span>
              </p>
              <p className="text-sm text-gray-600">{m.email ?? m.phone ?? '—'}</p>
              {!readOnly && <div className="mt-2"><ResetPassword member={m} /></div>}
            </li>
          ))}
        </ul>
      </section>

      {!readOnly && (
        <>
          <section aria-label="Suspension" className="card">
            <h3 className="mb-1 text-base font-semibold">{s.isSuspended ? 'Suspended' : 'Suspend salon'}</h3>
            <p className="mb-3 text-sm text-gray-600">
              {s.isSuspended
                ? 'Customers cannot take new tokens and staff cannot sign in.'
                : 'Stops new tokens and signs the staff out. Customers already waiting keep their tickets.'}
            </p>
            {suspend.isError && <p role="alert" className="mb-2 text-sm text-red-700">{errText(suspend.error)}</p>}
            {s.isSuspended ? (
              <button type="button" className="btn-primary" disabled={suspend.isPending} onClick={() => suspend.mutate(false)}>
                {suspend.isPending ? 'Saving...' : 'Unsuspend salon'}
              </button>
            ) : confirmSuspend ? (
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1 bg-red-700" disabled={suspend.isPending} onClick={() => suspend.mutate(true)}>
                  {suspend.isPending ? 'Suspending...' : `Yes, suspend ${s.name}`}
                </button>
                <button type="button" className="btn-secondary px-4" onClick={() => setConfirmSuspend(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => setConfirmSuspend(true)}>Suspend salon</button>
            )}
          </section>

          <section aria-label="Internal" className="card">
            <h3 className="mb-1 text-base font-semibold">Internal salon</h3>
            <p className="mb-3 text-sm text-gray-600">Internal salons (your own, demo or test accounts) are left out of all numbers.</p>
            {internal.isError && <p role="alert" className="mb-2 text-sm text-red-700">{errText(internal.error)}</p>}
            <button type="button" className="btn-secondary" disabled={internal.isPending} onClick={() => internal.mutate(!s.isInternal)}>
              {s.isInternal ? 'Mark as a real salon' : 'Mark as internal'}
            </button>
          </section>

          {s.isInternal && (
            <section aria-label="Delete salon" className="card border-red-300">
              <h3 className="mb-1 text-base font-semibold text-red-800">Delete salon</h3>
              <p className="mb-3 text-sm text-gray-600">
                Removes this salon, its staff accounts and all its queue history. This cannot be undone.
              </p>
              <label htmlFor="confirm-name" className="mb-1 block text-sm font-medium">
                Type <strong>{s.name}</strong> to confirm
              </label>
              <input id="confirm-name" className="field mb-3" value={deleteName} autoComplete="off"
                onChange={(e) => setDeleteName(e.target.value)} />
              {remove.isError && <p role="alert" className="mb-2 text-sm text-red-700">{errText(remove.error)}</p>}
              <button
                type="button"
                className="btn-primary bg-red-700"
                disabled={deleteName.trim() !== s.name.trim() || remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? 'Deleting...' : 'Delete salon forever'}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
