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
} from '../api/barber';
import { socket } from '../lib/socket';
import { SESSION_EXPIRED_EVENT, ApiError } from '../api/client';

const QUEUE_KEY = ['barberQueue'];

export default function BarberDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

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

  async function handleLogout() {
    await logoutBarber().catch(() => {});
    queryClient.clear();
    navigate('/barber/login');
  }

  if (isLoading) return <p role="status" className="p-6 text-gray-600">Loading queue...</p>;

  if (error || !queue) {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <p role="alert" className="text-red-700 mb-4">Not signed in, or your session expired.</p>
        <button
          onClick={() => navigate('/barber/login')}
          className="rounded-xl bg-black text-white py-3 px-6 font-medium"
        >
          Go to Login
        </button>
      </div>
    );
  }

  const isPaused = queue.queueStatus === 'PAUSED';
  const busy = primaryMutation.isPending || skipMutation.isPending || pauseMutation.isPending;
  const nextWaiting = queue.waiting[0] ?? null;
  const active = queue.serving ?? queue.called; // whoever is at the chair / being called

  // What the one button says and does right now.
  let label: string;
  let color = 'bg-black';
  let disabled = busy;
  if (queue.serving) {
    label = `COMPLETE #${queue.serving.token_number}`;
    color = 'bg-green-700';
  } else if (queue.called) {
    label = `START #${queue.called.token_number}`;
  } else if (isPaused) {
    label = 'RESUME QUEUE';
    color = 'bg-amber-700';
  } else if (nextWaiting) {
    label = `START NEXT #${nextWaiting.token_number}`;
  } else {
    label = 'NO ONE WAITING';
    disabled = true;
  }
  if (primaryMutation.isPending) label = 'Working...';

  const statusLine = queue.serving
    ? 'Serving'
    : queue.called
      ? 'Called — waiting to start'
      : isPaused
        ? 'Queue paused'
        : 'Idle';

  return (
    <main className="mx-auto w-full max-w-md md:max-w-2xl p-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Barber Dashboard</h1>
          <p className={`text-sm ${isPaused ? 'text-amber-700' : 'text-green-700'}`}>
            Queue {isPaused ? 'Paused' : 'Active'} — Current Token #{queue.currentToken}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <Link to="/barber/qr" className="inline-flex min-h-11 items-center px-3 text-sm text-gray-600 underline">
            Print salon QR
          </Link>
          <button onClick={handleLogout} className="min-h-11 px-3 text-sm text-gray-600 underline" type="button">
            Log out
          </button>
        </div>
      </div>

      {actionError && (
        <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {actionError}
        </p>
      )}

      <section aria-label="Current customer" className="rounded-xl border border-gray-200 bg-white p-6 mb-4 text-center">
        <p className="text-sm font-medium text-gray-600">{statusLine}</p>
        <p className="my-2 text-6xl font-bold">{active ? `#${active.token_number}` : '—'}</p>
      </section>

      <button
        type="button"
        onClick={() => primaryMutation.mutate()}
        disabled={disabled}
        className={`${color} mb-3 min-h-20 w-full rounded-2xl py-5 text-xl font-semibold text-white disabled:opacity-40`}
      >
        {label}
      </button>

      {/* Rare actions stay out of the way. Skip is here so a no-show can never block the queue. */}
      <details className="mb-6 rounded-xl border border-gray-200 bg-white p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">More actions</summary>
        <div className="mt-2 grid gap-3">
          {active && (
            <button
              type="button"
              onClick={() => skipMutation.mutate(active.id)}
              disabled={busy}
              className="min-h-12 rounded-xl border border-red-300 px-4 text-base font-medium text-red-700 disabled:opacity-40"
            >
              {`Skip #${active.token_number}`}
            </button>
          )}
          {!isPaused && (
            <button
              type="button"
              onClick={() => pauseMutation.mutate()}
              disabled={busy}
              className="min-h-12 rounded-xl border border-gray-500 px-4 text-base font-medium disabled:opacity-40"
            >
              Pause queue
            </button>
          )}
        </div>
      </details>

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-600">Waiting ({queue.waiting.length})</h2>
        {queue.waiting.length === 0 ? (
          <p className="text-gray-600">No one waiting.</p>
        ) : (
          <ul className="space-y-2">
            {queue.waiting.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-gray-200 bg-white p-3 font-semibold">
                #{entry.token_number}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}