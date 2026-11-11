// frontend/src/components/TeamSection.tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchTeam,
  addTeamMember,
  resetTeamMemberPassword,
  setTeamMemberActive,
  type TeamMember,
} from '../api/barber';
import { ApiError } from '../api/client';

const TEAM_KEY = ['barberTeam'];

// Prefer the specific reason ("Enter a valid 10-digit mobile number.") over the generic "Invalid request."
function errText(e: unknown, fallback: string) {
  if (e instanceof ApiError && e.fieldErrors) {
    const first = Object.values(e.fieldErrors).flat().find(Boolean);
    if (first) return first;
  }
  return e instanceof Error ? e.message : fallback;
}

function AddBarberForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const add = useMutation({
    mutationFn: () => addTeamMember({ name: name.trim(), phone: phone.trim(), password }),
    onSuccess: (member) => {
      setName('');
      setPhone('');
      setPassword('');
      setMsg({ ok: true, text: `${member.name} was added. They can sign in with their phone number.` });
      queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Could not add the barber.') }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    add.mutate();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 border-t border-gray-200 bg-gray-50 px-4 py-4 sm:grid-cols-2">
      <h3 className="text-sm font-semibold text-gray-700 sm:col-span-2">Add a barber</h3>
      <div>
        <label htmlFor="team-name" className="mb-1 block text-sm font-medium">Name</label>
        <input id="team-name" className="field" value={name} maxLength={60} autoComplete="off"
          onChange={(e) => { setName(e.target.value); setMsg(null); }} />
      </div>
      <div>
        <label htmlFor="team-phone" className="mb-1 block text-sm font-medium">Mobile number</label>
        <input id="team-phone" className="field" inputMode="tel" autoComplete="off" value={phone}
          onChange={(e) => { setPhone(e.target.value); setMsg(null); }} />
        <p className="mt-1 text-sm text-gray-600">They will sign in with this number.</p>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="team-password" className="mb-1 block text-sm font-medium">Password</label>
        <input id="team-password" type="password" className="field" autoComplete="new-password" value={password}
          maxLength={72} onChange={(e) => { setPassword(e.target.value); setMsg(null); }} />
        <p className="mt-1 text-sm text-gray-600">At least 8 characters. Tell it to your barber.</p>
      </div>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'}
          className={`text-sm sm:col-span-2 ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
      <button type="submit" className="btn-primary sm:col-span-2 sm:w-auto sm:justify-self-end sm:px-10"
        disabled={add.isPending || !name.trim() || !phone.trim() || password.length < 8}>
        {add.isPending ? 'Adding...' : 'Add barber'}
      </button>
    </form>
  );
}

function MemberRow({ member }: { member: TeamMember }) {
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isOwner = member.role === 'OWNER';

  const toggle = useMutation({
    mutationFn: () => setTeamMemberActive(member.id, !member.isActive),
    onSuccess: () => {
      setMsg(null);
      queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Could not update the barber.') }),
  });

  const reset = useMutation({
    mutationFn: () => resetTeamMemberPassword(member.id, password),
    onSuccess: () => {
      setPassword('');
      setResetting(false);
      setMsg({ ok: true, text: 'Password changed.' });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Could not change the password.') }),
  });

  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-semibold">
            {member.name}
            {isOwner && <span className="ml-2 text-sm font-normal text-gray-600">(Owner)</span>}
          </p>
          {!isOwner && <p className="text-sm text-gray-600">{member.phone}</p>}
        </div>
        {!isOwner && (
          <span className={`pill shrink-0 ${member.isActive ? 'border-green-300 bg-green-50 text-green-900' : 'border-gray-300 bg-gray-50 text-gray-700'}`}>
            {member.isActive ? 'Active' : 'Switched off'}
          </span>
        )}
      </div>

      {!isOwner && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-sm" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
            {member.isActive ? 'Switch off' : 'Switch on'}
          </button>
          <button type="button" className="btn-sm" onClick={() => { setResetting((v) => !v); setMsg(null); }}>
            Change password
          </button>
        </div>
      )}

      {resetting && (
        <div className="grid gap-2">
          <label htmlFor={`pw-${member.id}`} className="text-sm font-medium">New password for {member.name}</label>
          <input id={`pw-${member.id}`} type="password" className="field" autoComplete="new-password"
            value={password} maxLength={72} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="btn-primary" onClick={() => reset.mutate()}
            disabled={reset.isPending || password.length < 8}>
            {reset.isPending ? 'Saving...' : 'Save new password'}
          </button>
        </div>
      )}

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
    </li>
  );
}

export default function TeamSection({ asPage = false }: { asPage?: boolean }) {
  const Heading = asPage ? 'h1' : 'h2';
  const { data: team, isLoading, error, refetch } = useQuery({
    queryKey: TEAM_KEY,
    queryFn: fetchTeam,
    retry: false,
  });

  return (
    <section aria-labelledby="team-heading" className="mb-8">
      <div className="mb-3">
        <Heading id="team-heading" className={asPage ? 'text-2xl font-bold' : 'text-base font-bold'}>Barbers</Heading>
        <p className="text-sm text-gray-600">
          Add each barber so you can serve more than one customer at a time. Each barber signs in with their own mobile number.
        </p>
      </div>

      {isLoading ? (
        <p role="status" className="text-gray-600">Loading your team...</p>
      ) : error || !team ? (
        <div className="card text-center">
          <p role="alert" className="mb-3 text-red-700">Could not load your team.</p>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <ul className="divide-y divide-gray-200">
            {team.map((m) => (
              <MemberRow key={m.id} member={m} />
            ))}
          </ul>
          <AddBarberForm />
        </div>
      )}
    </section>
  );
}
