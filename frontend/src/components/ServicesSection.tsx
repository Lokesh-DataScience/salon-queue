// frontend/src/components/ServicesSection.tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchBarberServices,
  addBarberService,
  removeBarberService,
  type BarberService,
} from '../api/barber';

const SERVICES_KEY = ['barberServices'];
const MAX_SERVICES = 12;
const MIN_LEN = 2;
const MAX_LEN = 30;

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

export default function ServicesSection() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: SERVICES_KEY,
    queryFn: fetchBarberServices,
    retry: false,
  });

  const add = useMutation({
    mutationFn: (name: string) => addBarberService(name),
    onSuccess: (svc) => {
      queryClient.setQueryData<BarberService[]>(SERVICES_KEY, (old) => [...(old ?? []), svc]);
      setDraft('');
      setMsg({ ok: true, text: `Added "${svc.name}".` });
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not add.' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeBarberService(id),
    onSuccess: (_r, id) => {
      queryClient.setQueryData<BarberService[]>(SERVICES_KEY, (old) => (old ?? []).filter((s) => s.id !== id));
      setMsg(null);
    },
    onError: (e: unknown) => {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not remove.' });
      refetch(); // re-sync if it was already gone
    },
  });

  const busy = add.isPending || remove.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const items = data ?? [];
    const name = tidy(draft);
    if (name.length < MIN_LEN) return setMsg({ ok: false, text: 'Type a service name, at least 2 letters.' });
    if (name.length > MAX_LEN) return setMsg({ ok: false, text: 'Keep each service name under 30 characters.' });
    if (items.length >= MAX_SERVICES) return setMsg({ ok: false, text: 'You can add up to 12 services.' });
    if (items.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return setMsg({ ok: false, text: `"${name}" is already in your list.` });
    }
    setMsg(null);
    add.mutate(name);
  }

  if (isLoading) return <p role="status" className="text-gray-600">Loading your services...</p>;
  if (error || !data) {
    return (
      <div className="card text-center">
        <p role="alert" className="mb-3 text-red-700">Could not load your services.</p>
        <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }

  return (
    <div className="card grid gap-3">
      {data.length === 0 ? (
        <p className="text-sm text-gray-600">
          No services added. Customers will join the queue instantly without choosing one.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Your services">
          {data.map((s) => (
            <li key={s.id} className="flex items-center gap-1 rounded-full border-2 border-ink bg-brand-soft py-1 pl-4 pr-1">
              <span className="text-base font-medium">{s.name}</span>
              <button
                type="button"
                onClick={() => remove.mutate(s.id)}
                disabled={busy}
                aria-label={`Remove ${s.name}`}
                className="flex h-10 w-10 items-center justify-center rounded-full text-xl font-bold hover:bg-white disabled:opacity-40"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex gap-2" noValidate>
        <div className="flex-1">
          <label htmlFor="new-service" className="mb-1 block text-sm font-medium">Add a service</label>
          <input
            id="new-service"
            className="field"
            value={draft}
            maxLength={MAX_LEN}
            placeholder="e.g. head massage"
            onChange={(e) => { setDraft(e.target.value); setMsg(null); }}
          />
        </div>
        <button type="submit" className="btn-secondary mt-6 !w-auto" disabled={busy} aria-busy={add.isPending}>
          {add.isPending ? 'Adding...' : 'Add'}
        </button>
      </form>

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}