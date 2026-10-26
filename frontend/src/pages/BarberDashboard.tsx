// frontend/src/pages/BarberDashboard.tsx
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  fetchBarberQueue,
  callNextCustomer,
  startEntry,
  completeEntry,
  skipEntry,
  pauseQueue,
  resumeQueue,
  logoutBarber,
  type BarberQueueEntry,
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
      queryClient.clear(); // drops cached queue data from memory
      navigate('/barber/login', { replace: true, state: { expired: true } });
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [navigate, queryClient]);
  // Join this salon's room once we know its id, and treat queue:updated as
  // a signal to re-fetch the FULL snapshot (with names/phones) rather than
  // trying to render off the sanitized broadcast payload directly — that
  // payload intentionally excludes any customer details.
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
      .catch((err: any) => setActionError(err.message));
  }

  const nextMutation = useMutation({ mutationFn: () => runAction(callNextCustomer) });
  const startMutation = useMutation({ mutationFn: (id: string) => runAction(() => startEntry(id)) });
  const completeMutation = useMutation({ mutationFn: (id: string) => runAction(() => completeEntry(id)) });
  const skipMutation = useMutation({ mutationFn: (id: string) => runAction(() => skipEntry(id)) });
  const pauseMutation = useMutation({ mutationFn: () => runAction(pauseQueue) });
  const resumeMutation = useMutation({ mutationFn: () => runAction(resumeQueue) });

  async function handleLogout() {
    await logoutBarber().catch(() => {});
    queryClient.clear();
    navigate('/barber/login');
  }

  if (isLoading) return <p role="status" className="p-6 text-gray-600">Loading queue...</p>

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
  const anyMutating =
    nextMutation.isPending ||
    startMutation.isPending ||
    completeMutation.isPending ||
    skipMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending;

  const nextHint = queue.called
    ? 'Start or skip the called customer first.'
    : isPaused
      ? 'Resume the queue to call the next customer.'
      : '';

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

      {/* Currently Serving */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
        <h2 className="mb-2 text-sm font-medium text-gray-600">Currently Serving</h2>
        {queue.serving ? (
          <>
            <p className="text-4xl font-bold mb-3">#{queue.serving.token_number}</p>
            <div className="grid grid-cols-2 gap-3">
              <ActionButton
                label="Complete"
                color="bg-green-700"
                disabled={anyMutating}
                onClick={() => completeMutation.mutate(queue.serving!.id)}
              />
              <ActionButton
                label="Skip"
                color="bg-red-700"
                disabled={anyMutating}
                onClick={() => skipMutation.mutate(queue.serving!.id)}
              />
            </div>
          </>
        ) : (
          <p className="text-gray-600">No one being served right now.</p>
        )}
      </section>

      {/* Called / Next Up */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
        <h2 className="mb-2 text-sm font-medium text-gray-600">Called — Next Up</h2>
        {queue.called ? (
          <>
            <p className="text-3xl font-bold mb-4">#{queue.called.token_number}</p>
            <div className="grid grid-cols-2 gap-3">
              <ActionButton
                label="Start Service"
                color="bg-black"
                disabled={anyMutating}
                onClick={() => startMutation.mutate(queue.called!.id)}
              />
              <ActionButton
                label="Skip"
                color="bg-red-600"
                disabled={anyMutating}
                onClick={() => skipMutation.mutate(queue.called!.id)}
              />
            </div>
          </>
        ) : (
          <p className="text-gray-600">No one called yet.</p>
        )}
      </section>

      {/* Call Next */}
      <button
        type="button"
        onClick={() => nextMutation.mutate()}
        disabled={anyMutating || !!queue.called || isPaused}
        aria-describedby="next-hint"
        className="min-h-14 w-full rounded-xl bg-black py-4 text-lg font-semibold text-white disabled:opacity-40"
      >
        {nextMutation.isPending ? 'Calling...' : 'CALL NEXT CUSTOMER'}
      </button>
      <p id="next-hint" className="mb-3 mt-1 min-h-5 text-sm text-gray-600">{nextHint}</p>

      <button
        type="button"
        onClick={() => (isPaused ? resumeMutation.mutate() : pauseMutation.mutate())}
        disabled={anyMutating}
        className="mb-6 min-h-14 w-full rounded-xl border border-gray-500 bg-white py-4 text-lg font-semibold disabled:opacity-40"
      >
        {isPaused ? 'RESUME QUEUE' : 'PAUSE QUEUE'}
      </button>

      {/* Waiting list */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-600">Waiting ({queue.waiting.length})</h2>
        {queue.waiting.length === 0 ? (
          <p className="text-gray-600">No one waiting.</p>
        ) : (
          <ul className="space-y-2">
            {queue.waiting.map((entry) => (
              <WaitingRow
                key={entry.id}
                entry={entry}
                disabled={anyMutating}
                onSkip={() => skipMutation.mutate(entry.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ActionButton({ label, color, disabled, onClick }: {
  label: string; color: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${color} min-h-12 rounded-xl px-3 py-3 text-base font-medium text-white disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

function WaitingRow({ entry, disabled, onSkip }: {
  entry: BarberQueueEntry; disabled: boolean; onSkip: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="min-w-0">
        <span className="font-semibold">#{entry.token_number}</span>{' '}
      </div>
      <button
        type="button"
        onClick={onSkip}
        disabled={disabled}
        aria-label={`Skip token ${entry.token_number}`}
        className="min-h-11 shrink-0 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 disabled:opacity-40"
      >
        Skip
      </button>
    </li>
  );
}