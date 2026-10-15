// frontend/src/pages/BarberDashboard.tsx
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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

const QUEUE_KEY = ['barberQueue'];

export default function BarberDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: queue, isLoading, error } = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: fetchBarberQueue,
    // no refetchInterval — Milestone 4 replaces polling with sockets
  });

  function refetch() {
    return queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  }

  // Join this salon's room once we know its id, and treat queue:updated as
  // a signal to re-fetch the FULL snapshot (with names/phones) rather than
  // trying to render off the sanitized broadcast payload directly — that
  // payload intentionally excludes customer_name/customer_phone.
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
    await logoutBarber().catch(() => {}); // best-effort — always leave the page
    navigate('/barber/login');
  }

  if (isLoading) return <p className="p-6 text-gray-500">Loading queue...</p>;

  if (error || !queue) {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <p className="text-red-600 mb-4">Not signed in, or your session expired.</p>
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

  return (
    <div className="max-w-md mx-auto p-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Barber Dashboard</h1>
          <p className={`text-sm ${isPaused ? 'text-amber-600' : 'text-green-600'}`}>
            Queue {isPaused ? 'Paused' : 'Active'} — Current Token #{queue.currentToken}
          </p>
        </div>
        <button onClick={handleLogout} className="text-sm text-gray-500 underline shrink-0">
          Log out
        </button>
      </div>

      {actionError && (
        <p className="text-sm text-red-600 mb-4 rounded-lg bg-red-50 p-3">{actionError}</p>
      )}

      {/* Currently Serving */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
        <p className="text-sm text-gray-500 mb-2">Currently Serving</p>
        {queue.serving ? (
          <>
            <p className="text-4xl font-bold mb-1">#{queue.serving.token_number}</p>
            <p className="text-sm text-gray-600 mb-4">
              {queue.serving.customer_name} · {queue.serving.customer_phone}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <ActionButton
                label="Complete"
                color="bg-green-600"
                disabled={anyMutating}
                onClick={() => completeMutation.mutate(queue.serving!.id)}
              />
              <ActionButton
                label="Skip"
                color="bg-red-600"
                disabled={anyMutating}
                onClick={() => skipMutation.mutate(queue.serving!.id)}
              />
            </div>
          </>
        ) : (
          <p className="text-gray-400">No one being served right now.</p>
        )}
      </section>

      {/* Called / Next Up */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
        <p className="text-sm text-gray-500 mb-2">Called — Next Up</p>
        {queue.called ? (
          <>
            <p className="text-3xl font-bold mb-1">#{queue.called.token_number}</p>
            <p className="text-sm text-gray-600 mb-4">
              {queue.called.customer_name} · {queue.called.customer_phone}
            </p>
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
          <p className="text-gray-400">No one called yet.</p>
        )}
      </section>

      {/* Call Next */}
      <button
        onClick={() => nextMutation.mutate()}
        disabled={anyMutating || !!queue.called || isPaused}
        className="w-full rounded-xl bg-black text-white py-4 text-lg font-semibold disabled:opacity-40 mb-3"
      >
        {nextMutation.isPending ? 'Calling...' : 'CALL NEXT CUSTOMER'}
      </button>

      {/* Pause / Resume */}
      <button
        onClick={() => (isPaused ? resumeMutation.mutate() : pauseMutation.mutate())}
        disabled={anyMutating}
        className="w-full rounded-xl border border-gray-300 py-4 text-lg font-semibold disabled:opacity-40 mb-6"
      >
        {isPaused ? 'RESUME QUEUE' : 'PAUSE QUEUE'}
      </button>

      {/* Waiting list */}
      <section>
        <p className="text-sm text-gray-500 mb-2">Waiting ({queue.waiting.length})</p>
        {queue.waiting.length === 0 ? (
          <p className="text-gray-400">No one waiting.</p>
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
    </div>
  );
}

function ActionButton({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${color} text-white rounded-xl py-3 font-medium disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

function WaitingRow({
  entry,
  disabled,
  onSkip,
}: {
  entry: BarberQueueEntry;
  disabled: boolean;
  onSkip: () => void;
}) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
      <div>
        <span className="font-semibold">#{entry.token_number}</span>{' '}
        <span className="text-sm text-gray-500">{entry.customer_name}</span>
      </div>
      <button onClick={onSkip} disabled={disabled} className="text-sm text-red-600 disabled:opacity-40">
        Skip
      </button>
    </li>
  );
}