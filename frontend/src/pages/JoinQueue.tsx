// frontend/src/pages/JoinQueue.tsx
// The older "join from the salon page" flow (hidden in production by the discovery flag).
// It follows the same rule as the QR page: details once per salon, then a remembered phone.
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchSalonLanes } from '../api/salons';
import LanePicker from '../components/LanePicker';
import CustomerDetailsForm, { type CustomerDetails } from '../components/CustomerDetailsForm';
import { joinSalonQueue } from '../api/tickets';
import { ApiError } from '../api/client';
import { saveTicket } from '../lib/activeTickets';
import { clearRememberToken, getRememberToken, saveRememberToken } from '../lib/rememberToken';
import { useActiveTickets } from '../hooks/useActiveTickets';
import PageShell from '../components/PageShell';

export default function JoinQueue() {
  const { salonId } = useParams<{ salonId: string }>();
  const navigate = useNavigate();
  const { tickets: existing, isChecking } = useActiveTickets(salonId);
  const [addingAnother, setAddingAnother] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [laneId, setLaneId] = useState<string | null>(null); // null = Any barber
  // First visit to this salon from this phone: ask for details. Otherwise one tap, as before.
  const [askDetails, setAskDetails] = useState(() => !(salonId && getRememberToken(salonId)));
  // The barber choice only appears when the salon has more than one barber.
  const { data: lanes = [] } = useQuery({
    queryKey: ['salonLanes', salonId],
    queryFn: () => fetchSalonLanes(salonId!),
    enabled: !!salonId,
    retry: false,
  });

  async function handleJoin(who?: CustomerDetails) {
    setSubmitting(true);
    setError(null);
    try {
      const ticket = await joinSalonQueue(salonId!, undefined, undefined, laneId ?? undefined, {
        ...(who ? { name: who.name, phone: who.phone, consent: true } : {}),
        rememberToken: getRememberToken(salonId!) ?? undefined,
      });
      if (ticket.rememberToken) saveRememberToken(salonId!, ticket.rememberToken);
      saveTicket({
        ticketId: ticket.ticketId,
        accessToken: ticket.accessToken,
        salonId: ticket.salonId ?? salonId!,
        tokenNumber: ticket.tokenNumber,
      });
      navigate(`/tickets/${ticket.ticketId}?accessToken=${ticket.accessToken}`);
    } catch (err: any) {
      if (err instanceof ApiError && (err.code === 'CUSTOMER_DETAILS_REQUIRED' || err.code === 'CONSENT_REQUIRED')) {
        clearRememberToken(salonId!);
        setAskDetails(true);
        setError(who ? err.message : 'Please enter your details again.');
      } else {
        setError(err.message ?? 'Unable to join the queue. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <>
      <Link to={`/salons/${salonId}`} className="mb-3 inline-block min-h-11 py-2 text-sm text-gray-600 underline">
        ← Back to salon
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Join the queue</h1>
    </>
  );

  if (isChecking) {
    return (
      <PageShell title="Join the queue">
        {header}
        <p role="status" className="text-gray-600">Checking for an existing ticket...</p>
      </PageShell>
    );
  }

  if (existing.length > 0 && !addingAnother) {
    const first = existing[0];
    return (
      <PageShell title="Join the queue">
        {header}
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <p className="font-semibold">You already have an active queue ticket.</p>
          <p className="mt-1 text-sm">
            Token #{first.stored.tokenNumber}
            {first.ticket && ` · ${first.ticket.peopleAhead} ${first.ticket.peopleAhead === 1 ? 'person' : 'people'} ahead`}
          </p>
        </div>
        <Link
          to={`/tickets/${first.stored.ticketId}?accessToken=${first.stored.accessToken}`}
          className="btn-primary mt-4"
        >
          Go to my ticket
        </Link>
        <button type="button" onClick={() => setAddingAnother(true)} className="btn-secondary mt-3">
          Join for another person
        </button>
      </PageShell>
    );
  }

  return (
    <PageShell title="Join the queue">
      {header}
      {lanes.length > 1 && <LanePicker lanes={lanes} value={laneId} onChange={setLaneId} disabled={submitting} />}
      {askDetails ? (
        <CustomerDetailsForm busy={submitting} error={error ?? undefined} submitLabel="Get my token" onSubmit={(d) => void handleJoin(d)} />
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600">This salon already knows you. Tap once to get your token.</p>
          {error && (
            <p id="join-error" role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              {error}
            </p>
          )}
          <button type="button" onClick={() => void handleJoin()} disabled={submitting} className="btn-primary">
            {submitting ? 'Joining queue...' : 'Get my token'}
          </button>
        </>
      )}
    </PageShell>
  );
}