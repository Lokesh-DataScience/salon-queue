// frontend/src/pages/QueueTracking.tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { fetchTicketStatus, leaveTicket } from '../api/tickets';
import { socket } from '../lib/socket';
import { ApiError } from '../api/client';
import { saveTicket, removeTicket } from '../lib/activeTickets';
import NotifyMe from '../components/NotifyMe';
import PageShell from '../components/PageShell';
import { CUSTOMER_DISCOVERY } from '../lib/features';

type SanitizedQueueEntry = { id: string; tokenNumber: number; status: string };
type SanitizedQueueState = {
  salonId: string;
  currentToken: number;
  queueStatus: string;
  averageServiceMinutes: number;
  entries: SanitizedQueueEntry[];
};

const FINISHED = ['COMPLETED', 'SKIPPED', 'CANCELLED'];

function PrizeCard({ prize, status }: { prize: { name: string; code: string; redeemed: boolean }; status: string }) {
  const [revealed, setRevealed] = useState(false);
  const served = status === 'SERVING' || status === 'COMPLETED';

  if (prize.redeemed) {
    return (
      <section aria-label="Your reward" className="card mt-4 text-center">
        <p className="text-sm text-gray-600">Reward claimed</p>
        <p className="text-lg font-semibold">🎁 {prize.name}</p>
      </section>
    );
  }

  return (
    <section aria-label="Your reward" className="mt-4 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-center">
      {!revealed ? (
        <>
          <p className="text-lg font-semibold text-amber-900">🎁 You have a surprise reward!</p>
          <button type="button" className="btn-primary mt-3" onClick={() => setRevealed(true)}>
            Tap to reveal
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-amber-900">You won</p>
          <p className="text-2xl font-bold text-amber-950">🎉 {prize.name}</p>
          <p className="mt-3 text-sm text-amber-900">Your code</p>
          <p className="text-4xl font-extrabold tracking-[0.3em] tabular-nums">{prize.code}</p>
          <p className="mt-3 text-sm text-amber-900">
            {served
              ? 'Show this code to the barber now.'
              : 'Show this code to the barber once your service starts. It is valid today only.'}
          </p>
        </>
      )}
    </section>
  );
}

export default function QueueTracking() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get('accessToken') ?? '';
  const queryClient = useQueryClient();
  const queryKey = ['ticket', ticketId];
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const { data: ticket, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchTicketStatus(ticketId!, accessToken),
    enabled: !!ticketId && !!accessToken,
  });

  const leave = useMutation({
    mutationFn: () => leaveTicket(ticketId!, accessToken),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, (prev: any) =>
        prev ? { ...prev, status: 'CANCELLED' } : prev,
      );
    },
    // e.g. the barber called this customer a moment ago: refetch so the
    // screen shows the real status instead of a stale Leave button.
    onError: () => {
      setConfirmingLeave(false);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Join the salon's room once we know which salon this ticket belongs to.
  useEffect(() => {
    if (!ticket?.salonId) return;
    const salonId = ticket.salonId;

    function joinRoom() {
      socket.emit('join:salon', { salonId });
      queryClient.invalidateQueries({ queryKey }); // catch up after reconnects
    }

    joinRoom();
    socket.on('connect', joinRoom);

    return () => {
      socket.off('connect', joinRoom);
      socket.emit('leave:salon', { salonId });
    };
  }, [ticket?.salonId]);

  // Merge live broadcasts into this ticket's cached view.
  useEffect(() => {
    if (!ticketId) return;

    function handleUpdate(state: SanitizedQueueState) {
      const mine = state.entries.find((e) => e.id === ticketId);

      // Finished tickets drop out of the broadcast; refetch to learn which
      // final status we got (completed / skipped / cancelled).
      if (!mine) {
        queryClient.invalidateQueries({ queryKey });
        return;
      }

      queryClient.setQueryData(queryKey, (prev: any) => {
        if (!prev) return prev;
        const peopleAhead = state.entries.filter(
          (e) => e.status === 'WAITING' && e.tokenNumber < mine.tokenNumber,
        ).length;
        return {
          ...prev,
          status: mine.status,
          currentToken: state.currentToken,
          queueStatus: state.queueStatus,
          peopleAhead,
          estimatedWaitMinutes: peopleAhead * state.averageServiceMinutes,
        };
      });
    }

    socket.on('queue:updated', handleUpdate);
    return () => {
      socket.off('queue:updated', handleUpdate);
    };
  }, [ticketId, queryClient]);

  // Tab title as a cheap in-page alert for people who switched tabs.
  useEffect(() => {
    if (!ticket) return;
    const original = document.title;
    if (ticket.status === 'CALLED') document.title = `Your turn! #${ticket.tokenNumber}`;
    else if (ticket.status === 'WAITING' && ticket.peopleAhead <= 1)
      document.title = `Almost your turn · #${ticket.tokenNumber}`;
    return () => {
      document.title = original;
    };
  }, [ticket?.status, ticket?.peopleAhead, ticket?.tokenNumber]);

  // Keep the saved-ticket list honest: remember an active ticket (also covers opening the
  // link from another device), forget a finished or vanished one.
  useEffect(() => {
    if (!ticket || !ticketId) return;
    if (FINISHED.includes(ticket.status)) {
      removeTicket(ticketId);
    } else {
      saveTicket({ ticketId, accessToken, salonId: ticket.salonId, tokenNumber: ticket.tokenNumber });
    }
  }, [ticket?.status, ticketId]);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 404 && ticketId) removeTicket(ticketId);
  }, [error, ticketId]);
  const homeLabel = CUSTOMER_DISCOVERY ? 'Find a salon' : 'Back to home';

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <PageShell title="Your queue ticket">
        <div className="animate-pulse space-y-4" aria-hidden="true">
          <div className="h-40 rounded-3xl bg-gray-200" />
          <div className="h-32 rounded-xl bg-gray-200" />
        </div>
        <p role="status" className="mt-4 text-center text-gray-600">Loading your queue ticket...</p>
      </PageShell>
    );
  }

  // ── Missing / invalid ticket ───────────────────────────────────────────
  if (error || !ticket) {
    return (
      <PageShell title="Your queue ticket">
        <div className="card p-6 text-center">
          <span aria-hidden="true" className="mb-3 block text-4xl">🔍</span>
          <p role="alert" className="text-red-700">
            We couldn't find this queue ticket. It may have expired, or the link is incomplete.
          </p>
          <Link to="/" className="btn-secondary mt-6">{homeLabel}</Link>
        </div>
      </PageShell>
    );
  }

  // ── Finished states ────────────────────────────────────────────────────
  if (FINISHED.includes(ticket.status)) {
    const message =
      ticket.status === 'COMPLETED'
        ? 'Your service is complete. Thank you!'
        : ticket.status === 'SKIPPED'
          ? 'The salon skipped your turn. If this looks like a mistake, please speak to the salon staff.'
          : 'You left the queue.';
    const icon = ticket.status === 'COMPLETED' ? '✅' : ticket.status === 'SKIPPED' ? '⏭️' : '👋';
    return (
      <PageShell title="Your queue ticket">
        <div className="card p-8 text-center">
          <span aria-hidden="true" className="mb-2 block text-4xl">{icon}</span>
          <p className="text-5xl font-bold tabular-nums text-gray-500">#{ticket.tokenNumber}</p>
          <p className="mt-4 text-gray-800" role="status">{message}</p>
          {ticket.status === 'COMPLETED' && ticket.prize && (
            <PrizeCard prize={ticket.prize} status={ticket.status} />
          )}
          <Link to="/" className="btn-secondary mt-6">{homeLabel}</Link>
        </div>
      </PageShell>
    );
  }

  // ── Status banner (color + icon + text, never color alone) ─────────────
  let banner: { icon: string; text: string; detail: string; classes: string } | null = null;
  if (ticket.status === 'CALLED') {
    banner = { icon: '🔔', text: "It's your turn", detail: 'Please head to the counter now.', classes: 'border-green-400 bg-green-50 text-green-900' };
  } else if (ticket.status === 'SERVING') {
    banner = { icon: '✂️', text: 'Service in progress', detail: 'You are being served.', classes: 'border-blue-300 bg-blue-50 text-blue-900' };
  } else if (ticket.status === 'WAITING' && ticket.peopleAhead === 0) {
    banner = { icon: '🚶', text: "You're next", detail: 'Start making your way to the salon.', classes: 'border-amber-400 bg-amber-50 text-amber-900' };
  } else if (ticket.status === 'WAITING' && ticket.peopleAhead === 1) {
    banner = { icon: '⏳', text: "You're getting close", detail: 'Only one person is ahead of you.', classes: 'border-amber-300 bg-amber-50 text-amber-900' };
  }

  const canLeave = ticket.status === 'WAITING';
  const leaveError = leave.error instanceof Error ? leave.error.message : leave.error ? 'Unable to leave the queue. Please try again.' : null;

  return (
    <PageShell title="Your queue ticket">
      {/* Token */}
      <section aria-label="Your token" className="rounded-3xl bg-gray-900 px-6 py-8 text-center text-white">
        <p className="text-sm font-medium uppercase tracking-widest text-gray-300">Your token</p>
        <p className="my-1 text-7xl font-extrabold tabular-nums">#{ticket.tokenNumber}</p>
      </section>

      {ticket.queueStatus === 'PAUSED' && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <span aria-hidden="true">⏸</span>
          <span>The salon has paused the queue for now. Your place is saved.</span>
        </p>
      )}

      {banner && (
        <div
          className={`mt-4 flex items-start gap-3 rounded-2xl border-2 p-4 ${banner.classes}`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" className="text-3xl leading-none">{banner.icon}</span>
          <div>
            <p className="text-xl font-semibold">{banner.text}</p>
            <p className="text-sm">{banner.detail}</p>
          </div>
        </div>
      )}

      {/* Live numbers */}
      <section aria-label="Queue status" className="card mt-4 divide-y divide-gray-200 p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-gray-600">Now serving</span>
          <span className="text-2xl font-bold tabular-nums">#{ticket.currentToken}</span>
        </div>
        <div className="px-4 py-3">
          <p className="text-lg font-semibold">
            {ticket.peopleAhead} {ticket.peopleAhead === 1 ? 'person' : 'people'} ahead
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-sm text-gray-700">Estimated wait: ~{ticket.estimatedWaitMinutes} min</p>
        </div>
      </section>
      {ticket.prize && <PrizeCard prize={ticket.prize} status={ticket.status} />}

      {ticket.status === 'WAITING' && (
        <NotifyMe ticketId={ticket.ticketId} accessToken={accessToken} enabled={!!ticket.notificationsOn} />
      )}

      {!ticket.notificationsOn ? (
        <p className="mt-4 text-center text-sm text-gray-600">
          Keep this page open. It updates live as the queue moves.
        </p>
      ) : (
        ticket.status === 'WAITING' && (
          <p className="mt-4 text-center text-sm text-gray-600">
            You can close this page. Keep your internet on and we'll alert you as your turn gets close.
          </p>
        )
      )}

      {canLeave && (
        <div className="mt-8">
          {!confirmingLeave ? (
            <button type="button" onClick={() => setConfirmingLeave(true)} className="btn-secondary">
              Leave queue
            </button>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alertdialog" aria-label="Confirm leaving the queue">
              <p className="mb-3 text-sm text-red-900">Leave the queue? You will lose your place.</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => leave.mutate()}
                  disabled={leave.isPending}
                  className="btn-danger flex-1"
                >
                  {leave.isPending ? 'Leaving...' : 'Yes, leave'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingLeave(false)}
                  disabled={leave.isPending}
                  className="btn-secondary flex-1"
                >
                  Stay
                </button>
              </div>
            </div>
          )}
          {leaveError && <p className="mt-3 text-sm text-red-700" role="alert">{leaveError}</p>}
        </div>
      )}
    </PageShell>
  );
}