import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchTicketStatus } from '../api/tickets';

export default function QueueTracking() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get('accessToken') ?? '';

  const { data: ticket, isLoading, error } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => fetchTicketStatus(ticketId!, accessToken),
    refetchInterval: 8000, // poll every 8s until Milestone 4 adds sockets
    enabled: !!ticketId && !!accessToken,
  });

  if (isLoading) return <p className="p-6 text-gray-500">Loading your queue ticket...</p>;
  if (error || !ticket) return <p className="p-6 text-red-600">Your queue ticket has expired.</p>;

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