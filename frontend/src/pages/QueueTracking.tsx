// frontend/src/pages/QueueTracking.tsx
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchTicketStatus } from '../api/tickets';
import { socket } from '../lib/socket';

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

  const { data: ticket, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchTicketStatus(ticketId!, accessToken),
    enabled: !!ticketId && !!accessToken,
    // no refetchInterval — Milestone 4 replaces polling with sockets
  });

  // Join the salon's room once we know which salon this ticket belongs to.
  // frontend/src/pages/QueueTracking.tsx

    // Join the salon's room once we know which salon this ticket belongs to.
  useEffect(() => {
    if (!ticket?.salonId) return;
    const salonId = ticket.salonId;

    function joinRoom() {
      socket.emit('join:salon', { salonId });
      queryClient.invalidateQueries({ queryKey }); // catch up on anything missed while offline
    }

    joinRoom(); // Socket.IO buffers this if the socket isn't connected yet
    socket.on('connect', joinRoom); // runs again after every reconnect

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

      if (!mine) {
        queryClient.invalidateQueries({ queryKey });
        return;
      }

      queryClient.setQueryData(queryKey, (prev: any) => {
        if (!prev) return prev;
        const peopleAhead = state.entries.filter(
          (e) => e.status === 'WAITING' && e.tokenNumber < mine.tokenNumber
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

  if (isLoading) return <p className="p-6 text-gray-500">Loading your queue ticket...</p>;
  if (error || !ticket) return <p className="p-6 text-red-600">Your queue ticket has expired.</p>;
  if (ticket.status === 'SKIPPED' || ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED') {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <p className="text-5xl font-bold mb-2">#{ticket.tokenNumber}</p>
        <p className="text-gray-600">
          {ticket.status === 'COMPLETED' ? 'Your service is complete.' : 'You are no longer in the queue.'}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 text-center">
      <p className="text-sm text-gray-500">Your Token</p>
      <p className="text-5xl font-bold my-2">#{ticket.tokenNumber}</p>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 space-y-2">
        <p className="text-sm text-gray-600">Currently Serving: <span className="font-medium">#{ticket.currentToken}</span></p>
        <p className="text-sm text-gray-600">{ticket.peopleAhead} people ahead</p>
        <p className="text-sm text-gray-600">Estimated wait: ~{ticket.estimatedWaitMinutes} min</p>
      </div>

      <p className="mt-6 text-sm text-gray-500">
        We'll notify you when your turn is approaching.
      </p>
    </div>
  );
}