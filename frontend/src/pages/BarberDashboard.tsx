// frontend/src/pages/BarberDashboard.tsx
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchBarberQueue,
  callNextCustomer,
  startEntry,
  completeEntry,
  skipEntry,
  pauseQueue,
  resumeQueue,
  logoutBarber,
  addWalkIn,
} from '../api/barber';
import { redeemCode } from '../api/offers';
import { socket } from '../lib/socket';
import { SESSION_EXPIRED_EVENT, ApiError } from '../api/client';

const QUEUE_KEY = ['barberQueue'];

export default function BarberDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [redeemInput, setRedeemInput] = useState('');
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const redeem = useMutation({
    mutationFn: () => redeemCode(redeemInput),
    onSuccess: (r) => { setRedeemMsg({ ok: true, text: `Redeemed: ${r.prizeName}. Give it to the customer.` }); setRedeemInput(''); },
    onError: (e: any) => setRedeemMsg({ ok: false, text: e.message ?? 'Could not redeem.' }),
  });

  const { data: queue, isLoading, error } = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: fetchBarberQueue,
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
  });
  function refetch() {
    return queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  }

  // The API client emits this only after a silent refresh has failed.
  useEffect(() => {
    function onExpired() {
      queryClient.clear();
      navigate('/barber/login', { replace: true, state: { expired: true } });
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [navigate, queryClient]);

  // queue:updated is only a signal to re-fetch the full snapshot; the broadcast
  // payload is sanitized and deliberately carries no customer details.
  useEffect(() => {
    if (!queue?.salonId) return;
    const salonId = queue.salonId;

    function joinRoom() {
      socket.emit('join:salon', { salonId });
      refetch();
    }

    joinRoom();
    socket.on('connect', joinRoom);
    socket.on('queue:updated', refetch);

    return () => {
      socket.off('connect', joinRoom);
      socket.off('queue:updated', refetch);
      socket.emit('leave:salon', { salonId });
    };
  }, [queue?.salonId]);

  function runAction<T>(action: () => Promise<T>) {
    setActionError(null);
    return action()
      .then(() => refetch())
      .catch((err: any) => {
        setActionError(err.message);
        return refetch(); // re-sync so the button reflects what really happened
      });
  }

  // ── The one primary action ─────────────────────────────────────────────
  // The server still enforces every transition; this only picks which call to make.
  const primaryMutation = useMutation({
    mutationFn: () =>
      runAction(async () => {
        if (!queue) return;
        if (queue.serving) {
          await completeEntry(queue.serving.id); // SERVING → COMPLETED
        } else if (queue.called) {
          await startEntry(queue.called.id); // CALLED → SERVING
        } else if (queue.queueStatus === 'PAUSED') {
          await resumeQueue();
        } else {
          // Idle: call the next customer and start them in one tap.
          // If start fails, the customer stays CALLED and the button becomes "Start #N".
          const { result } = await callNextCustomer();
          const calledId = (result as { called_entry_id?: string | null } | null)?.called_entry_id;
          if (calledId) await startEntry(calledId);
        }
      }),
  });
  const skipMutation = useMutation({ mutationFn: (id: string) => runAction(() => skipEntry(id)) });
  const pauseMutation = useMutation({ mutationFn: () => runAction(pauseQueue) });
  const [walkInMsg, setWalkInMsg] = useState<string | null>(null);
    useEffect(() => {
      if (!walkInMsg) return;
      const t = setTimeout(() => setWalkInMsg(null), 6000);
      return () => clearTimeout(t);
    }, [walkInMsg]);
    const walkInMutation = useMutation({
      mutationFn: addWalkIn,
      onMutate: () => {
        setActionError(null);
        setWalkInMsg(null);
      },
      onSuccess: (r) => {
        setWalkInMsg(`Token #${r.entry.tokenNumber} added to the queue.`);
        refetch();
      },
      onError: (err: any) => {
        setActionError(err.message);
        refetch();
      },
  });
  async function handleLogout() {
    await logoutBarber().catch(() => {});
    queryClient.clear();
    navigate('/barber/login');
  }

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-md p-4 md:max-w-2xl">
        <div className="animate-pulse space-y-4" aria-hidden="true">
          <div className="h-8 w-40 rounded bg-gray-200" />
          <div className="h-44 rounded-2xl bg-gray-200" />
          <div className="h-20 rounded-2xl bg-gray-200" />
        </div>
        <p role="status" className="mt-4 text-center text-gray-600">Loading queue...</p>
      </main>
    );
  }

  if (error || !queue) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="card p-6 text-center">
          <p role="alert" className="mb-4 text-red-700">Not signed in, or your session expired.</p>
          <button onClick={() => navigate('/barber/login')} className="btn-primary">
            Go to Login
          </button>
        </div>
      </main>
    );
  }

  const isPaused = queue.queueStatus === 'PAUSED';
  const busy = primaryMutation.isPending || skipMutation.isPending || pauseMutation.isPending || walkInMutation.isPending;
  const nextWaiting = queue.waiting[0] ?? null;
  const active = queue.serving ?? queue.called; // whoever is at the chair / being called

  // What the one button says and does right now.
  let label: string;
  let color = 'bg-black hover:bg-gray-800';
  let disabled = busy;
  if (queue.serving) {
    label = `COMPLETE #${queue.serving.token_number}`;
    color = 'bg-green-700 hover:bg-green-800';
  } else if (queue.called) {
    label = `START #${queue.called.token_number}`;
  } else if (isPaused) {
    label = 'RESUME QUEUE';
    color = 'bg-amber-700 hover:bg-amber-800';
  } else if (nextWaiting) {
    label = `START NEXT #${nextWaiting.token_number}`;
  } else {
    label = 'NO ONE WAITING';
    disabled = true;
  }
  if (primaryMutation.isPending) label = 'Working...';

  const statusLine = queue.serving
    ? 'Serving now'
    : queue.called
      ? 'Called — waiting to start'
      : isPaused
        ? 'On a break'
        : 'Ready';

  const cardTone = queue.serving
    ? 'border-green-400 bg-green-50'
    : queue.called
      ? 'border-amber-400 bg-amber-50'
      : 'border-gray-200 bg-white';

  return (
    <>
      <main className="mx-auto w-full max-w-md p-4 pb-36 md:max-w-2xl">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Salon queue</h1>
            <p className="text-sm text-gray-600">Current token #{queue.currentToken}</p>
          </div>
          <span
            className={`pill shrink-0 ${
              isPaused ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-green-300 bg-green-50 text-green-900'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${isPaused ? 'bg-amber-600' : 'bg-green-600'}`}
            />
            {isPaused ? 'Queue paused' : 'Queue active'}
          </span>
        </header>

        <nav aria-label="Account" className="mb-4 flex gap-2">
          <Link
            to="/barber/offers"
            className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
            Offers
          </Link>
          <Link
            to="/barber/qr"
            className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Print salon QR
          </Link>
          <button
            onClick={handleLogout}
            className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50"
            type="button"
          >
            Log out
          </button>
        </nav>

        {actionError && (
          <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {actionError}
          </p>
        )}

        <section
          aria-label="Current customer"
          className={`mb-4 rounded-2xl border-2 p-6 text-center ${cardTone}`}
        >
          <p className="text-sm font-medium uppercase tracking-wide text-gray-700">{statusLine}</p>
          <p className="my-2 text-7xl font-bold tabular-nums">{active ? `#${active.token_number}` : '—'}</p>
          {!active && nextWaiting && !isPaused && (
            <p className="text-sm text-gray-600">Next up: #{nextWaiting.token_number}</p>
          )}
        </section>

        {/* Rare actions stay out of the way. Skip is here so a no-show can never block the queue. */}
        <details className="mb-6 rounded-xl border border-gray-200 bg-white px-3">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-gray-700">More actions</summary>
          <div className="grid gap-3 pb-3">
            {active && (
              <button
                type="button"
                onClick={() => skipMutation.mutate(active.id)}
                disabled={busy}
                className="min-h-12 rounded-xl border border-red-300 px-4 text-base font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                {`Skip #${active.token_number}`}
              </button>
            )}
            {!isPaused && (
              <button
                type="button"
                onClick={() => pauseMutation.mutate()}
                disabled={busy}
                className="min-h-12 rounded-xl border border-gray-500 px-4 text-base font-medium hover:bg-gray-50 disabled:opacity-40"
              >
                Pause queue
              </button>
            )}
          </div>
        </details>
        <section aria-label="Redeem a reward" className="mb-6 rounded-xl border border-gray-200 bg-white p-3">
          <label htmlFor="redeem-code" className="mb-1 block text-sm font-medium text-gray-700">
            Customer showed a reward code?
          </label>
          <div className="flex gap-2">
            <input
              id="redeem-code"
              className="field uppercase tracking-widest"
              value={redeemInput}
              maxLength={7}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="ABC234"
              onChange={(e) => { setRedeemInput(e.target.value); setRedeemMsg(null); }}
            />
            <button
              type="button"
              className="btn-primary !w-auto"
              disabled={redeem.isPending || redeemInput.replace(/[\s-]/g, '').length < 6}
              onClick={() => redeem.mutate()}
            >
              Redeem
            </button>
          </div>
          {redeemMsg && (
            <p role="status" className={`mt-2 text-sm ${redeemMsg.ok ? 'text-green-800' : 'text-red-700'}`}>
              {redeemMsg.text}
            </p>
          )}
        </section>
        <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-gray-700">Waiting ({queue.waiting.length})</h2>
              <button
                type="button"
                onClick={() => walkInMutation.mutate()}
                disabled={busy || isPaused}
                aria-busy={walkInMutation.isPending}
                className="min-h-12 rounded-xl border-2 border-black bg-white px-5 text-lg font-semibold hover:bg-gray-50 disabled:border-gray-300 disabled:text-gray-500"
              >
                {walkInMutation.isPending ? 'Adding...' : '+1 Add walk-in'}
              </button>
            </div>
            {isPaused && (
              <p className="mb-2 text-sm text-gray-600">Resume the queue to add a walk-in.</p>
            )}
            {walkInMsg && (
              <p role="status" className="mb-3 rounded-lg border border-green-300 bg-green-50 p-3 text-base font-medium text-green-900">
                {walkInMsg}
              </p>
            )}
          {queue.waiting.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 p-4 text-center text-gray-600">
              No one waiting.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {queue.waiting.map((entry, i) => (
                <li
                  key={entry.id}
                  className="flex flex-col items-center rounded-xl border border-gray-200 bg-white py-3 text-xl font-semibold tabular-nums"
                >
                  #{entry.token_number}
                  {i === 0 && <span className="text-xs font-medium text-gray-600">Next</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* The one big button sits at the bottom of the screen, within thumb reach. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-md md:max-w-2xl">
          <button
            type="button"
            onClick={() => primaryMutation.mutate()}
            disabled={disabled}
            aria-busy={primaryMutation.isPending}
            className={`${color} min-h-20 w-full rounded-2xl py-5 text-xl font-semibold text-white disabled:bg-gray-200 disabled:text-gray-600 disabled:hover:bg-gray-200`}
          >
            {label}
          </button>
        </div>
      </div>
    </>
  );
}