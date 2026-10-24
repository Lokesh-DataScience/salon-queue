// frontend/src/components/ResumeTicketBanner.tsx
import { Link } from 'react-router-dom';
import { useActiveTickets } from '../hooks/useActiveTickets';

export default function ResumeTicketBanner({ salonId }: { salonId?: string }) {
  const { tickets } = useActiveTickets(salonId);
  if (tickets.length === 0) return null;

  return (
    <section aria-label="Your active queue tickets" className="mb-4 space-y-3 text-left">
      {tickets.map(({ stored, ticket }) => (
        <div key={stored.ticketId} className="rounded-xl border border-blue-300 bg-blue-50 p-4 text-blue-900">
          <p className="font-semibold">You have an active queue ticket · #{stored.tokenNumber}</p>
          {ticket && (
            <p className="text-sm">
              {ticket.status === 'CALLED'
                ? "It's your turn."
                : ticket.status === 'SERVING'
                  ? 'Service in progress.'
                  : `${ticket.peopleAhead} ${ticket.peopleAhead === 1 ? 'person' : 'people'} ahead · ~${ticket.estimatedWaitMinutes} min`}
            </p>
          )}
          <Link
            to={`/tickets/${stored.ticketId}?accessToken=${stored.accessToken}`}
            className="btn-primary mt-3"
          >
            View my ticket
          </Link>
        </div>
      ))}
    </section>
  );
}