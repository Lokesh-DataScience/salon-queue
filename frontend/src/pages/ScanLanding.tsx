// frontend/src/pages/ScanLanding.tsx
// Where a salon's wall QR lands (/q/:code). One scan = one ticket, no taps:
// resolve the salon, resume this phone's active ticket if it has one, otherwise take a token and open it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchSalonByCode } from '../api/salons';
import { fetchTicketStatus, joinSalonQueue } from '../api/tickets';
import { ApiError } from '../api/client';
import { getTickets, removeTicket, saveTicket } from '../lib/activeTickets';
import PageShell from '../components/PageShell';

const FINISHED = ['COMPLETED', 'SKIPPED', 'CANCELLED'];

type View =
  | { kind: 'working'; salonName?: string }
  | { kind: 'error'; title: string; message: string; salonName?: string; canRetry: boolean };

const ticketUrl = (ticketId: string, accessToken: string) =>
  `/tickets/${ticketId}?accessToken=${accessToken}`;

export default function ScanLanding() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: 'working' });
  // React StrictMode runs effects twice in development. This makes sure a scan can never take two tokens.
  const started = useRef(false);

  const run = useCallback(async () => {
    setView({ kind: 'working' });
    let salonName: string | undefined;
    try {
      const salon = await fetchSalonByCode(code ?? '');
      salonName = salon.name;
      setView({ kind: 'working', salonName });

      // Scanning again must never hand out a second token: go back to the ticket this phone already holds.
      for (const stored of getTickets(salon.id)) {
        try {
          const t = await fetchTicketStatus(stored.ticketId, stored.accessToken);
          if (t && !FINISHED.includes(t.status)) {
            navigate(ticketUrl(stored.ticketId, stored.accessToken), { replace: true });
            return;
          }
          removeTicket(stored.ticketId);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) removeTicket(stored.ticketId);
          // Any other failure (e.g. offline): we can't prove the ticket is dead, so keep it and try the next one.
        }
      }

      const ticket = await joinSalonQueue(salon.id);
      saveTicket({
        ticketId: ticket.ticketId,
        accessToken: ticket.accessToken,
        salonId: ticket.salonId ?? salon.id,
        tokenNumber: ticket.tokenNumber,
      });
      navigate(ticketUrl(ticket.ticketId, ticket.accessToken), { replace: true });
    } catch (err) {
      if (!salonName && err instanceof ApiError && err.status === 404) {
        setView({
          kind: 'error',
          title: 'QR code not recognised',
          message: 'Please scan the QR code displayed at the salon again, or ask the salon staff for help.',
          canRetry: false,
        });
        return;
      }
      setView({
        kind: 'error',
        title: salonName ? "Can't get a token right now" : "Couldn't open the queue",
        message:
          err instanceof ApiError
            ? err.message
            : 'We could not reach the server. Please check your internet connection and try again.',
        salonName,
        canRetry: true,
      });
    }
  }, [code, navigate]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  if (view.kind === 'error') {
    return (
      <PageShell title="Get your token">
        <div className="flex min-h-[60dvh] flex-col justify-center text-center">
          {view.salonName && <p className="mb-2 text-sm text-gray-600">{view.salonName}</p>}
          <h1 className="text-xl font-semibold">{view.title}</h1>
          <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {view.message}
          </p>
          {view.canRetry && (
            <button type="button" onClick={() => void run()} className="btn-primary mt-6">
              Try again
            </button>
          )}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Get your token">
      <div className="flex min-h-[60dvh] flex-col justify-center text-center">
        {view.salonName && <p className="mb-2 text-sm text-gray-600">{view.salonName}</p>}
        <h1 className="text-xl font-semibold">Getting your token...</h1>
        <p role="status" className="mt-2 text-gray-600">
          Please wait a moment. No sign-up needed.
        </p>
      </div>
    </PageShell>
  );
}
