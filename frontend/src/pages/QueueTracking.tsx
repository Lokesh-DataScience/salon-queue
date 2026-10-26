import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { fetchTicketStatus, leaveTicket } from '../api/tickets';
import { socket } from '../lib/socket';
import { ApiError } from '../api/client';
import { saveTicket, removeTicket } from '../lib/activeTickets';
import NotifyMe from '../components/NotifyMe';
import { CUSTOMER_DISCOVERY } from '../lib/features';

type SanitizedQueueEntry = { id: string; tokenNumber: number; status: string };
type SanitizedQueueState = {
  salonId: string;
  currentToken: number;
  queueStatus: string;
  averageServiceMinutes: number;
  entries: SanitizedQueueEntry[];
};

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
    if (['COMPLETED', 'SKIPPED', 'CANCELLED'].includes(ticket.status)) {
      removeTicket(ticketId);
    } else {
      saveTicket({ ticketId, accessToken, salonId: ticket.salonId, tokenNumber: ticket.tokenNumber });
    }
  }, [ticket?.status, ticketId]);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 404 && ticketId) removeTicket(ticketId);
  }, [error, ticketId]);

  if (isLoading) return <p role="status" className="p-6 text-gray-600">Loading your queue ticket...</p>;
  if (error || !ticket) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p role="alert" className="text-red-700">
          We couldn't find this queue ticket. It may have expired, or the link is incomplete.
        </p>
        <Link to="/" className="btn-secondary mt-6">
          {CUSTOMER_DISCOVERY ? 'Find a salon' : 'Back to home'}
        </Link>
      </div>
    );
  }

  // ── Finished states ────────────────────────────────────────────────────
  if (['COMPLETED', 'SKIPPED', 'CANCELLED'].includes(ticket.status)) {
    const message =
      ticket.status === 'COMPLETED'
        ? 'Your service is complete. Thank you!'
        : ticket.status === 'SKIPPED'
          ? 'The salon skipped your turn. If this looks like a mistake, please speak to the salon staff.'
          : 'You left the queue.';
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <p className="text-5xl font-bold mb-2">#{ticket.tokenNumber}</p>
        <p className="text-gray-700" role="status">{message}</p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-xl border border-gray-300 px-5 py-3 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
        >
          {CUSTOMER_DISCOVERY ? 'Find a salon' : 'Back to home'}
        </Link>
      </div>
    );
  }

  // ── Status banner (color + text, never color alone) ────────────────────
  let banner: { text: string; detail: string; classes: string } | null = null;
  if (ticket.status === 'CALLED') {
    banner = { text: "It's your turn", detail: 'Please head to the counter now.', classes: 'border-green-300 bg-green-50 text-green-900' };
  } else if (ticket.status === 'SERVING') {
    banner = { text: 'Service in progress', detail: 'You are being served.', classes: 'border-blue-300 bg-blue-50 text-blue-900' };
  } else if (ticket.status === 'WAITING' && ticket.peopleAhead === 0) {
    banner = { text: "You're next", detail: 'Start making your way to the salon.', classes: 'border-amber-300 bg-amber-50 text-amber-900' };
  } else if (ticket.status === 'WAITING' && ticket.peopleAhead === 1) {
    banner = { text: "You're getting close", detail: 'Only one person is ahead of you.', classes: 'border-amber-300 bg-amber-50 text-amber-900' };
  }

  const canLeave = ticket.status === 'WAITING';
  const leaveError = leave.error instanceof Error ? leave.error.message : leave.error ? 'Unable to leave the queue. Please try again.' : null;

  return (
    <div className="max-w-md mx-auto p-4 text-center">
      <p className="text-sm text-gray-500">Your Token</p>
      <p className="text-5xl font-bold my-2">#{ticket.tokenNumber}</p>

      {ticket.queueStatus === 'PAUSED' && (
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          ⏸ The salon has paused the queue for now. Your place is saved.
        </p>
      )}

      {banner && (
        <div className={`mt-4 rounded-xl border p-4 ${banner.classes}`} role="status" aria-live="polite">
          <p className="text-lg font-semibold">{banner.text}</p>
          <p className="text-sm">{banner.detail}</p>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 space-y-2">
        <p className="text-sm text-gray-600">Currently Serving: <span className="font-medium">#{ticket.currentToken}</span></p>
        <p className="text-sm text-gray-600">{ticket.peopleAhead} {ticket.peopleAhead === 1 ? 'person' : 'people'} ahead</p>
        <p className="text-sm text-gray-600">Estimated wait: ~{ticket.estimatedWaitMinutes} min</p>
      </div>

      {ticket.status === 'WAITING' && (
        <NotifyMe ticketId={ticket.ticketId} accessToken={accessToken} enabled={!!ticket.notificationsOn} />
      )}
      {!ticket.notificationsOn && (
        <p className="mt-6 text-sm text-gray-600">Keep this page open. It updates live as the queue moves.</p>
      )}

      {canLeave && (
        <div className="mt-6">
          {!confirmingLeave ? (
            <button
              type="button"
              onClick={() => setConfirmingLeave(true)}
              className="w-full rounded-xl border border-gray-300 px-5 py-3 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            >
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
                  className="flex-1 rounded-xl bg-red-700 px-4 py-3 text-base font-medium text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-900"
                >
                  {leave.isPending ? 'Leaving...' : 'Yes, leave'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingLeave(false)}
                  disabled={leave.isPending}
                  className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                >
                  Stay
                </button>
              </div>
            </div>
          )}
          {leaveError && <p className="mt-3 text-sm text-red-700" role="alert">{leaveError}</p>}
        </div>
      )}
    </div>
  );
}
