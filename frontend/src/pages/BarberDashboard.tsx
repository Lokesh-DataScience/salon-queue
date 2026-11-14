// frontend/src/pages/BarberDashboard.tsx
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  fetchBarberQueue,
  callNextCustomer,
  startEntry,
  completeEntry,
  skipEntry,
  pauseQueue,
  resumeQueue,
  addWalkIn,
  prioritizeEntry,
  fetchMe,
  redeemPrizeForEntry,
  markNotHere,
} from '../api/barber';
import { fetchPublicQueue } from '../api/salons';
import BarberLaneSwitcher from '../components/BarberLaneSwitcher';
import ChangePassword from '../components/ChangePassword';
import CustomerLine from '../components/CustomerLine';
import { socket } from '../lib/socket';
import { SESSION_EXPIRED_EVENT, ApiError } from '../api/client';
import type { BarberQueueEntry, BarberQueueSnapshot } from '../api/barber';
const QUEUE_KEY = ['barberQueue']; // other lines use [...QUEUE_KEY, laneId], so invalidating QUEUE_KEY refreshes them all
const LANE_STORE = 'svq.barber.lane'; // which line the owner was looking at (not personal data)

// Marks a customer who took their token from the customer app (they may still be on the way).
function AppBadge() {
  return (
    <span className="pill shrink-0 border-ink bg-brand-soft text-xs font-semibold text-ink" title="Joined from the app">
      📱 App
    </span>
  );
}

export default function BarberDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  // The owner can look at any barber's line; null means their own. Staff always get their own.
  const [selectedLane, setSelectedLane] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(LANE_STORE);
    } catch {
      return null;
    }
  });
  function chooseLane(id: string | null) {
    setSelectedLane(id);
    try {
      if (id) sessionStorage.setItem(LANE_STORE, id);
      else sessionStorage.removeItem(LANE_STORE);
    } catch {
      /* storage can be unavailable; the choice just will not be remembered */
    }
  }
  const lane = selectedLane ?? undefined;

  const { data: me } = useQuery({ queryKey: ['barberMe'], queryFn: () => fetchMe(), retry: false });
  const isStaff = me?.role === 'BARBER' || me?.role === 'MANAGER';

  const { data: queue, isLoading, error } = useQuery({
    queryKey: selectedLane ? [...QUEUE_KEY, selectedLane] : QUEUE_KEY,
    queryFn: () => (selectedLane ? fetchBarberQueue(selectedLane) : fetchBarberQueue()),
    retry: (count, err) =>
      !(err instanceof ApiError && (err.status === 401 || err.status === 404)) && count < 2,
  });

  // A line that no longer exists (a barber was removed): go back to the owner's own line.
  useEffect(() => {
    if (selectedLane && error instanceof ApiError && error.status === 404) chooseLane(null);
  }, [error, selectedLane]);

  // Weekly off today? Read from the salon's public view, so the owner and staff both see it.
  // Only a banner: it never blocks the dashboard, and +1 walk-ins keep working.
  const { data: publicView } = useQuery({
    queryKey: ['publicQueue', queue?.salonId],
    queryFn: () => fetchPublicQueue(queue!.salonId),
    enabled: !!queue?.salonId,
    retry: false,
    refetchInterval: 5 * 60_000, // the day changes at midnight
  });
  const offDayToday = !!publicView?.isOffDay;

  const refetching = useRef(false);
  const refetchAgain = useRef(false);
  async function refetch() {
    if (refetching.current) {
      refetchAgain.current = true;
      return;
    }
    refetching.current = true;
    try {
      do {
        refetchAgain.current = false;
        await queryClient.refetchQueries({ queryKey: QUEUE_KEY, type: 'active' }, { cancelRefetch: false });
      } while (refetchAgain.current);
    } finally {
      refetching.current = false;
    }
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
      .then(() => { if (!socket.connected) void refetch(); })
      .catch((err: any) => {
        setActionError(err.message);
        void refetch(); // re-sync so the screen shows what really happened
      });
  }
  const queueKey = selectedLane ? [...QUEUE_KEY, selectedLane] : QUEUE_KEY;
  async function showNow(change: (q: BarberQueueSnapshot) => BarberQueueSnapshot) {
    await queryClient.cancelQueries({ queryKey: QUEUE_KEY }); // an older fetch must not overwrite this
    queryClient.setQueryData<BarberQueueSnapshot>(queueKey, (old) => (old ? change(old) : old));
  }
  // ── The one primary action ─────────────────────────────────────────────
  // The server still enforces every transition; this only picks which call to make.
  const primaryMutation = useMutation({
    mutationFn: () =>
      runAction(async () => {
        if (!queue) return;
        if (queue.serving) {
          await showNow((q) => {
            const [next, ...rest] = q.waiting; // the server starts the next customer after a complete
            return { ...q, serving: next ? { ...next, status: 'SERVING' } : null, waiting: rest,
                     currentToken: next ? next.token_number : q.currentToken };
          });
          await completeEntry(queue.serving.id);
        } else if (queue.called) {
          await showNow((q) => ({ ...q, serving: q.called ? { ...q.called, status: 'SERVING' } : null, called: null }));
          await startEntry(queue.called.id);
        } else if (queue.queueStatus === 'PAUSED') {
          await (lane ? resumeQueue(lane) : resumeQueue());
        } else {
          // Idle: call the next customer and start them in one tap.
          // If start fails, the customer stays CALLED and the button becomes "Start #N".
          const { result } = await (lane ? callNextCustomer(lane) : callNextCustomer());
          const calledId = (result as { called_entry_id?: string | null } | null)?.called_entry_id;
          if (calledId) await startEntry(calledId);
        }
      }),
  });
  const skipMutation = useMutation({ mutationFn: (id: string) => runAction(() => skipEntry(id)) });
  const pauseMutation = useMutation({
    mutationFn: () => runAction(() => (lane ? pauseQueue(lane) : pauseQueue())),
  });

    // One tap gives the winner their prize. The server checks the customer is at this barber's chair.
  const redeemMutation = useMutation({
    mutationFn: (entryId: string) =>
      runAction(async () => {
        const given = (e: BarberQueueEntry | null) =>
          e && e.id === entryId && e.prize ? { ...e, prize: { ...e.prize, redeemed: true } } : e;
        await showNow((q) => ({ ...q, called: given(q.called), serving: given(q.serving) }));
        await redeemPrizeForEntry(entryId);
      }),
  });

  // Emergency: serve a waiting customer right after the current one.
  const [bumpTarget, setBumpTarget] = useState<{ id: string; token_number: number } | null>(null);
  const bumpMutation = useMutation({
    mutationFn: (id: string) => runAction(() => prioritizeEntry(id)),
    onSettled: () => setBumpTarget(null),
  });

  // "Not here": an app customer who has not reached the salon. Confirmed in a sheet, like the emergency bump.
  const [notHereTarget, setNotHereTarget] = useState<{ id: string; token_number: number; willCancel: boolean } | null>(null);
  const notHereMutation = useMutation({
    mutationFn: (id: string) => runAction(() => markNotHere(id)),
    onSettled: () => setNotHereTarget(null),
  });

  const [walkInMsg, setWalkInMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!walkInMsg) return;
    const t = setTimeout(() => setWalkInMsg(null), 6000);
    return () => clearTimeout(t);
  }, [walkInMsg]);
  const walkInMutation = useMutation({
    mutationFn: () => (lane ? addWalkIn(lane) : addWalkIn()),
    onMutate: () => {
      setActionError(null);
      setWalkInMsg(null);
    },
    onSuccess: (r) => {
      setWalkInMsg(
        r.entry.laneName
          ? `Token #${r.entry.tokenNumber} added to ${r.entry.laneName}'s line.`
          : `Token #${r.entry.tokenNumber} added to the queue.`,
      );
      queryClient.setQueryData<BarberQueueSnapshot>(queueKey, (old) =>
        old && !old.waiting.some((e) => e.id === r.entry.id)
          ? {
              ...old,
              waiting: [
                ...old.waiting,
                {
                  id: r.entry.id, token_number: r.entry.tokenNumber, status: 'WAITING',
                  joined_at: new Date().toISOString(), called_at: null, started_at: null,
                  completed_at: null, skipped_at: null, priority_at: null,
                  customer_name: null, customer_phone: null,
                },
              ],
            }
          : old,
      );
      if (!socket.connected) void refetch();
    },
    onError: (err: any) => {
      setActionError(err.message);
      void refetch();
    },
  });

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-md p-4 md:max-w-2xl">
        <div className="animate-pulse space-y-4" aria-hidden="true">
          <div className="h-20 rounded-2xl bg-gray-200" />
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
  const multi = !!queue.lane; // several barbers: this screen is about one line
  const busy =
    primaryMutation.isPending ||
    skipMutation.isPending ||
    pauseMutation.isPending ||
    walkInMutation.isPending ||
    bumpMutation.isPending ||
    notHereMutation.isPending;
  const nextWaiting = queue.waiting[0] ?? null;
  const active = queue.serving ?? queue.called; // whoever is at the chair / being called
  // Only app customers can be "not here": a wall-QR scan means they were standing in the shop.
  // Second time, or nobody else waiting, the server cancels instead of moving back.
  const notHereWillCancel = !!active && ((active.not_here_count ?? 0) >= 1 || queue.waiting.length === 0);

  // What the one button says and does right now.
  let label: string;
  let color = 'bg-brand text-ink hover:bg-brand-dark';
  let disabled = busy;
  if (queue.serving) {
    label = `COMPLETE #${queue.serving.token_number}`;
    color = 'bg-green-700 text-white hover:bg-green-800';
  } else if (queue.called) {
    label = `START #${queue.called.token_number}`;
  } else if (isPaused) {
    label = multi ? 'RESUME LINE' : 'RESUME QUEUE';
    color = 'bg-amber-700 text-white hover:bg-amber-800';
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
    ? 'border-green-600 bg-green-50'
    : queue.called
      ? 'border-ink bg-brand-soft'
      : 'border-gray-300 bg-white';

  return (
    <>
      <main className="mx-auto w-full max-w-md p-4 pb-36 md:max-w-2xl">
        <header className="mb-3 flex items-start justify-between gap-3 rounded-2xl bg-ink p-4 text-white">
          <div className="flex items-center gap-3">
            <img src="/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 rounded-xl" />
            <div>
              <h1 className="text-xl font-semibold">{queue.lane ? `${queue.lane.name}'s line` : 'Salon queue'}</h1>
              <p className="text-sm text-gray-300">Current token #{queue.currentToken}</p>
            </div>
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
            {isPaused ? (multi ? 'Line paused' : 'Queue paused') : multi ? 'Line active' : 'Queue active'}
          </span>
        </header>

        {queue.lanes && queue.lanes.length > 1 && (
          <BarberLaneSwitcher lanes={queue.lanes} selectedId={selectedLane} onSelect={chooseLane} />
        )}

        {offDayToday && (
          <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
            <strong>Today is your weekly off.</strong> Customers can't take a token from the QR or the app. You can
            still add walk-ins with +1.
          </p>
        )}

        {actionError && (
          <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {actionError}
          </p>
        )}

        <section
          aria-label="Current customer"
          className={`mb-4 rounded-2xl border-2 p-6 text-center ${cardTone}`}
        >
          <p className="text-sm font-bold uppercase tracking-wide text-gray-700">{statusLine}</p>
          <p className="my-2 text-8xl font-extrabold tabular-nums text-ink">{active ? `#${active.token_number}` : '—'}</p>
          {active && <CustomerLine name={active.customer_name} phone={active.customer_phone} center />}
          {active?.join_source === 'app' && (
            <div className="mt-3 grid justify-items-center gap-3">
              <AppBadge />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setNotHereTarget({ id: active.id, token_number: active.token_number, willCancel: notHereWillCancel })
                }
                className="min-h-12 w-full rounded-xl border-2 border-amber-700 bg-white px-4 text-base font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-40"
              >
                {notHereWillCancel
                  ? `Not here — cancel #${active.token_number}`
                  : `Not here — move #${active.token_number} back 2`}
              </button>
            </div>
          )}
          {queue.serving?.prize &&
            (queue.serving.prize.redeemed ? (
              <p role="status" className="mt-3 text-base font-semibold text-green-800">
                {`🎁 ${queue.serving.prize.name} — given ✓`}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => redeemMutation.mutate(queue.serving!.id)}
                disabled={redeemMutation.isPending}
                className="mt-4 min-h-14 w-full rounded-xl border-2 border-ink bg-brand px-4 text-lg font-bold text-ink hover:bg-brand-dark disabled:opacity-40"
              >
                {`🎁 Redeem prize: ${queue.serving.prize.name}`}
              </button>
            ))}
          {!queue.serving && queue.called?.prize && (
            <p className="mt-3 text-sm font-semibold text-ink">🎁 Has a reward. You can give it once service starts.</p>
          )}
          {!active && nextWaiting && !isPaused && (
            <p className="text-sm text-gray-700">Next up: #{nextWaiting.token_number}</p>
          )}
        </section>

        {/* Rare actions stay out of the way. Skip is here so a no-show can never block the queue. */}
        <details className="mb-6 rounded-xl border-2 border-gray-300 bg-white px-3">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-gray-700">More actions</summary>
          <div className="grid gap-3 pb-3">
            {active && (
              <button
                type="button"
                onClick={() => skipMutation.mutate(active.id)}
                disabled={busy}
                className="min-h-12 rounded-xl border-2 border-red-300 px-4 text-base font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                {`Skip #${active.token_number}`}
              </button>
            )}
            {!isPaused && (
              <button
                type="button"
                onClick={() => pauseMutation.mutate()}
                disabled={busy}
                className="min-h-12 rounded-xl border-2 border-ink px-4 text-base font-medium hover:bg-brand-soft disabled:opacity-40"
              >
                {multi ? 'Pause this line' : 'Pause queue'}
              </button>
            )}
          </div>
        </details>

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-700">Waiting ({queue.waiting.length})</h2>
            <button
              type="button"
              onClick={() => walkInMutation.mutate()}
              disabled={busy || isPaused}
              aria-busy={walkInMutation.isPending}
              className="min-h-12 rounded-xl border-2 border-ink bg-white px-5 text-lg font-bold text-ink hover:bg-brand-soft disabled:border-gray-300 disabled:text-gray-500"
            >
              {walkInMutation.isPending ? 'Adding...' : '+1 Add walk-in'}
            </button>
          </div>
          {isPaused && (
            <p className="mb-2 text-sm text-gray-600">
              {multi ? 'Resume this line to add a walk-in.' : 'Resume the queue to add a walk-in.'}
            </p>
          )}
          {walkInMsg && (
            <p role="status" className="mb-3 rounded-lg border border-green-300 bg-green-50 p-3 text-base font-medium text-green-900">
              {walkInMsg}
            </p>
          )}
          {queue.waiting.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-gray-300 p-4 text-center text-gray-600">
              No one waiting.
            </p>
          ) : (
            <>
              {queue.waiting.length > 1 && (
                <p className="mb-2 text-sm text-gray-600">Emergency? Tap a token to serve it next.</p>
              )}
              <ul className="grid gap-2">
                {queue.waiting.map((entry, i) => {
                  const isPriority = !!entry.priority_at;
                  const base =
                    'flex w-24 shrink-0 flex-col items-center rounded-xl border-2 py-3 text-xl font-bold tabular-nums text-ink';
                  const tone =
                    i === 0
                      ? 'border-ink bg-brand'
                      : isPriority
                        ? 'border-ink bg-brand-soft'
                        : 'border-gray-200 bg-white';
                  return (
                    <li key={entry.id} className="flex items-center gap-3">
                      {i === 0 || isPriority ? (
                        <div className={`${base} ${tone}`}>
                          #{entry.token_number}
                          <span className="text-xs font-semibold">
                            {isPriority ? (i === 0 ? '⚡ Priority · Next' : '⚡ Priority') : 'Next'}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Serve #${entry.token_number} next`}
                          disabled={busy}
                          onClick={() => setBumpTarget({ id: entry.id, token_number: entry.token_number })}
                          className={`${base} ${tone} min-h-14 hover:bg-brand-soft disabled:opacity-40`}
                        >
                          #{entry.token_number}
                        </button>
                      )}
                      <CustomerLine name={entry.customer_name} phone={entry.customer_phone} />
                      {entry.join_source === 'app' && <AppBadge />}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {isStaff && <ChangePassword />}
      </main>

      {/* The one big button sits at the bottom of the screen, within thumb reach. */}
      <div className="above-barber-nav fixed inset-x-0 z-10 border-t-2 border-ink bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md md:max-w-2xl">
          <button
            type="button"
            onClick={() => primaryMutation.mutate()}
            disabled={disabled}
            aria-busy={primaryMutation.isPending}
            className={`${color} min-h-20 w-full rounded-2xl border-2 border-ink py-5 text-xl font-bold shadow-[0_4px_0_0_var(--color-ink)] active:translate-y-[2px] active:shadow-none disabled:border-gray-300 disabled:bg-gray-200 disabled:text-gray-600 disabled:shadow-none disabled:hover:bg-gray-200`}
          >
            {label}
          </button>
        </div>
      </div>

      {/* "Not here" confirm sheet: one extra tap, because it moves or cancels someone's ticket. */}
      {notHereTarget && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/50 p-4"
          onClick={() => !notHereMutation.isPending && setNotHereTarget(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="not-here-title"
            className="mx-auto w-full max-w-md rounded-2xl border-2 border-ink bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="not-here-title" className="text-xl font-bold text-ink">
              {notHereTarget.willCancel
                ? `Cancel token #${notHereTarget.token_number}?`
                : `Move #${notHereTarget.token_number} back 2 places?`}
            </h2>
            <p className="mt-1 text-sm text-gray-700">
              {notHereTarget.willCancel
                ? 'They are not here again (or no one else is waiting). Their token will be cancelled and they will be told.'
                : 'The next customer starts now. They will be told to hurry; if they are still not here next time, the token is cancelled.'}
            </p>
            <div className="mt-4 grid gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={notHereMutation.isPending}
                onClick={() => notHereMutation.mutate(notHereTarget.id)}
              >
                {notHereMutation.isPending
                  ? 'Working...'
                  : notHereTarget.willCancel
                    ? 'Yes, cancel token'
                    : 'Yes, move back'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={notHereMutation.isPending}
                onClick={() => setNotHereTarget(null)}
              >
                Keep waiting
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emergency confirm sheet: one extra tap so a stray touch can never reorder the queue. */}
      {bumpTarget && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/50 p-4"
          onClick={() => !bumpMutation.isPending && setBumpTarget(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="bump-title"
            className="mx-auto w-full max-w-md rounded-2xl border-2 border-ink bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="bump-title" className="text-xl font-bold text-ink">
              Serve #{bumpTarget.token_number} next?
            </h2>
            <p className="mt-1 text-sm text-gray-700">
              They go right after the current customer. Everyone else keeps their order.
            </p>
            <div className="mt-4 grid gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={bumpMutation.isPending}
                onClick={() => bumpMutation.mutate(bumpTarget.id)}
              >
                {bumpMutation.isPending ? 'Moving...' : 'Yes, serve next'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={bumpMutation.isPending}
                onClick={() => setBumpTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
