// frontend/src/pages/JoinQueue.tsx
import { ApiError } from '../api/client';
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { joinSalonQueue } from '../api/tickets';
import { saveTicket } from '../lib/activeTickets';
import { useActiveTickets } from '../hooks/useActiveTickets';
import PageShell from '../components/PageShell';

export default function JoinQueue() {
  const { salonId } = useParams<{ salonId: string }>();
  const navigate = useNavigate();
  const { tickets: existing, isChecking } = useActiveTickets(salonId);
  const [addingAnother, setAddingAnother] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const ticket = await joinSalonQueue(salonId!, name.trim(), phone.trim());
      saveTicket({
        ticketId: ticket.ticketId,
        accessToken: ticket.accessToken,
        salonId: ticket.salonId ?? salonId!,
        tokenNumber: ticket.tokenNumber,
      });
      navigate(`/tickets/${ticket.ticketId}?accessToken=${ticket.accessToken}`);
    } catch (err: any) {
      if (err instanceof ApiError && (err.fieldErrors?.name || err.fieldErrors?.phone)) {
        setFieldErrors({ name: err.fieldErrors?.name?.[0], phone: err.fieldErrors?.phone?.[0] });
      } else {
        setError(err.message === 'Invalid request.' ? 'Please check your details and try again.' : err.message);
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
      <p className="mb-4 text-sm text-gray-600">
        No account required. Your details are only used for this queue and notifications.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">Your name</label>
          <input 
            id="name" 
            className="field" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            autoComplete="name" required
            aria-invalid={!!fieldErrors.name} 
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
          />
          {fieldErrors.name && <p id="name-error" className="mt-1 text-sm text-red-800">{fieldErrors.name}</p>}
        </div>
        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium">Your mobile number</label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="field"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-describedby={`phone-hint${fieldErrors.phone ? ' phone-error' : ''}`}
            aria-invalid={!!fieldErrors.phone}
            required
          />
          <p id="phone-hint" className="mt-1 text-sm text-gray-600">Spaces and +91 are fine.</p>
            {fieldErrors.phone && <p id="phone-error" className="mt-1 text-sm text-red-800">{fieldErrors.phone}</p>}  
        </div>
        {error && (
          <p id="join-error" role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Joining queue...' : 'Get my token'}
        </button>
      </form>
    </PageShell>
  );
}