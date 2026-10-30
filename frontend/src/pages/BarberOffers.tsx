// frontend/src/pages/BarberOffers.tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {setExpectedCustomers, fetchOffers, createOffer, updateOffer, deleteOffer, type Offer } from '../api/offers';
import { ApiError, SESSION_EXPIRED_EVENT } from '../api/client';

const KEY = ['barberOffers'];

export default function BarberOffers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [count, setCount] = useState('5');
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCount, setEditCount] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: KEY,
    queryFn: fetchOffers,
    retry: (n, err) => !(err instanceof ApiError && err.status === 401) && n < 2,
  });
  const [expected, setExpected] = useState('');
  const [expectedMsg, setExpectedMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (data) setExpected(data.expectedCustomers == null ? '' : String(data.expectedCustomers));}, [data?.expectedCustomers]);
  const saveExpected = useMutation({
    mutationFn: (value: number | null) => setExpectedCustomers(value),
    onSuccess: (r) => {
        setExpectedMsg({
        ok: true,
        text: r.expectedCustomers == null ? 'Saved. The app will estimate for you.' : 'Saved.',
        });
        refresh();
    },
    onError: (e: unknown) =>
        setExpectedMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }),
  });
  function submitExpected(e: React.FormEvent) {
    e.preventDefault();
    setExpectedMsg(null);
    if (expected.trim() === '') return saveExpected.mutate(null);
    const n = Number(expected);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
        return setExpectedMsg({ ok: false, text: 'Enter a number from 1 to 500, or leave it empty.' });
    }
    saveExpected.mutate(n);
  }
  useEffect(() => {
    function onExpired() {
      queryClient.clear();
      navigate('/barber/login', { replace: true, state: { expired: true } });
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [navigate, queryClient]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const onErr = (e: unknown) => setFormError(e instanceof Error ? e.message : 'Something went wrong.');

  const add = useMutation({
    mutationFn: () => createOffer({ name: name.trim(), dailyCount: Number(count) }),
    onSuccess: () => { setName(''); setCount('5'); setFormError(null); refresh(); },
    onError: onErr,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; p: { dailyCount?: number; active?: boolean } }) => updateOffer(v.id, v.p),
    onSuccess: () => { setEditingId(null); setFormError(null); refresh(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteOffer(id),
    onSuccess: () => { setConfirmDeleteId(null); refresh(); },
    onError: onErr,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(count);
    if (name.trim().length < 2) return setFormError('Give the offer a name, e.g. "Head massage".');
    if (!Number.isInteger(n) || n < 1 || n > 50) return setFormError('Enter a number from 1 to 50.');
    setFormError(null);
    add.mutate();
  }

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-md p-4 md:max-w-2xl">
        <p role="status" className="mt-8 text-center text-gray-600">Loading offers...</p>
      </main>
    );
  }
  if (error || !data) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="card p-6 text-center">
          <p role="alert" className="mb-4 text-red-700">Not signed in, or your session expired.</p>
          <button onClick={() => navigate('/barber/login')} className="btn-primary">Go to Login</button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md p-4 pb-12 md:max-w-2xl">
      <header className="mb-4">
        <Link to="/barber/dashboard" className="text-sm font-medium text-gray-700 underline">← Back to queue</Link>
        <h1 className="mt-2 text-xl font-semibold">Customer offers</h1>
        <p className="text-sm text-gray-600">
          Customers who scan your QR may win a surprise reward. You pick the offers and how many
          per day. Winners are chosen at random, so even you won't know who wins until they show you their code.
        </p>
      </header>

      <form onSubmit={submit} className="card mb-6 grid gap-3" noValidate>
        <h2 className="text-base font-semibold">Add an offer</h2>
        <div>
          <label htmlFor="offer-name" className="mb-1 block text-sm font-medium">Offer name</label>
          <input id="offer-name" className="field" value={name} maxLength={40}
            placeholder="Head massage" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="offer-count" className="mb-1 block text-sm font-medium">How many per day</label>
          <input id="offer-count" className="field" inputMode="numeric" value={count}
            onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </div>
        {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
        <button type="submit" className="btn-primary" disabled={add.isPending}>
          {add.isPending ? 'Adding...' : 'Add offer'}
        </button>
      </form>
      <form onSubmit={submitExpected} className="card mb-6 grid gap-3" noValidate>
        <h2 className="text-base font-semibold">Customers per day</h2>
        <div>
            <label htmlFor="expected-customers" className="mb-1 block text-sm font-medium">
            About how many customers do you get in a day?
            </label>
            <input
            id="expected-customers"
            className="field"
            inputMode="numeric"
            value={expected}
            placeholder="Leave empty to let the app estimate"
            onChange={(e) => { setExpected(e.target.value.replace(/\D/g, '').slice(0, 3)); setExpectedMsg(null); }}
            />
            <p className="mt-1 text-sm text-gray-600">
            Rewards are spread over this many customers, so they last through the day instead of going to the first few.
            </p>
        </div>
        {expectedMsg && (
            <p role={expectedMsg.ok ? 'status' : 'alert'} className={`text-sm ${expectedMsg.ok ? 'text-green-800' : 'text-red-700'}`}>
            {expectedMsg.text}
            </p>
        )}
        <button type="submit" className="btn-secondary" disabled={saveExpected.isPending}>
            {saveExpected.isPending ? 'Saving...' : 'Save'}
        </button>
        </form>
      <section aria-label="Your offers">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-gray-700">Your offers ({data.offers.length})</h2>
          <span className="text-sm text-gray-600">Redeemed today: {data.totalRedeemedToday}</span>
        </div>

        {data.offers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 p-4 text-center text-gray-600">
            No offers yet. Add one above to start rewarding customers.
          </p>
        ) : (
          <ul className="grid gap-3">
            {data.offers.map((o: Offer) => (
              <li key={o.id} className={`card ${o.active ? '' : 'opacity-70'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{o.name}</p>
                    <p className="text-sm text-gray-600">
                      {o.dailyCount} per day · redeemed today: {o.redeemedToday}
                    </p>
                  </div>
                  <span className={`pill shrink-0 ${o.active ? 'border-green-300 bg-green-50 text-green-900' : 'border-gray-300 bg-gray-50 text-gray-700'}`}>
                    {o.active ? 'On' : 'Off'}
                  </span>
                </div>

                {editingId === o.id ? (
                  <div className="mt-3 flex items-end gap-2">
                    <div className="flex-1">
                      <label htmlFor={`edit-${o.id}`} className="mb-1 block text-sm font-medium">Per day</label>
                      <input id={`edit-${o.id}`} className="field" inputMode="numeric" value={editCount}
                        onChange={(e) => setEditCount(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                    </div>
                    <button type="button" className="btn-primary !w-auto"
                      onClick={() => patch.mutate({ id: o.id, p: { dailyCount: Number(editCount) } })}
                      disabled={patch.isPending}>Save</button>
                    <button type="button" className="btn-secondary !w-auto" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                ) : confirmDeleteId === o.id ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3" role="alertdialog" aria-label={`Delete ${o.name}`}>
                    <p className="mb-2 text-sm text-red-900">Delete this offer? Customers who already won it today can still redeem.</p>
                    <div className="flex gap-2">
                      <button type="button" className="btn-danger flex-1" onClick={() => remove.mutate(o.id)} disabled={remove.isPending}>Yes, delete</button>
                      <button type="button" className="btn-secondary flex-1" onClick={() => setConfirmDeleteId(null)}>Keep</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary !w-auto"
                      onClick={() => patch.mutate({ id: o.id, p: { active: !o.active } })} disabled={patch.isPending}>
                      {o.active ? 'Turn off' : 'Turn on'}
                    </button>
                    <button type="button" className="btn-secondary !w-auto"
                      onClick={() => { setEditingId(o.id); setEditCount(String(o.dailyCount)); }}>Edit</button>
                    <button type="button" className="btn-secondary !w-auto" onClick={() => setConfirmDeleteId(o.id)}>Delete</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}