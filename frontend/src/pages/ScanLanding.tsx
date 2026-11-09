// frontend/src/pages/ScanLanding.tsx
// Where a salon's wall QR lands (/q/:code). Resume this phone's active ticket if it has one.
// Salons with services show a picker first; salons without join straight away.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchSalonByCode, fetchSalonLanes, type PublicLane } from '../api/salons';
import { fetchSalonServices, type PublicService } from '../api/publicServices';
import { fetchTicketStatus, joinSalonQueue } from '../api/tickets';
import { ApiError } from '../api/client';
import { getTickets, removeTicket, saveTicket } from '../lib/activeTickets';
import { clearJoinKey, getJoinKey } from '../lib/joinKey';
import { askPushPermission, enablePushAfterJoin } from '../lib/push';
import PageShell from '../components/PageShell';
import ServicePicker from '../components/ServicePicker';
import LanePicker from '../components/LanePicker';

const FINISHED = ['COMPLETED', 'SKIPPED', 'CANCELLED'];

// The barber list must never get in the way of taking a token: any failure just means "no choice".
async function loadLanes(salonId: string): Promise<PublicLane[]> {
  try {
    return await fetchSalonLanes(salonId);
  } catch {
    return [];
  }
}

type View =
  | { kind: 'working'; salonName?: string }
  | { kind: 'choose'; salon: { id: string; name: string }; services: PublicService[]; lanes: PublicLane[]; error?: string }
  | { kind: 'error'; title: string; message: string; salonName?: string; canRetry: boolean };

const ticketUrl = (ticketId: string, accessToken: string) =>
  `/tickets/${ticketId}?accessToken=${accessToken}`;

// Two tabs (or a reload) scanning the same salon take turns, so the second one finds the first one's ticket.
async function withSalonLock<T>(salonId: string, fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as unknown as { locks?: { request: <R>(name: string, cb: () => Promise<R>) => Promise<R> } }).locks;
  return locks?.request ? locks.request(`join:${salonId}`, fn) : fn();
}

export default function ScanLanding() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: 'working' });
  const [joining, setJoining] = useState(false);
  const [laneId, setLaneId] = useState<string | null>(null); // null = Any barber
  // React StrictMode runs effects twice in development. This makes sure a scan can never take two tokens.
  const started = useRef(false);
  // A second tap on "Try again" while a request is in flight does nothing.
  const running = useRef(false);

  // The same key for every attempt of this scan, so the server never creates a second ticket for it.
  const joinNow = useCallback(
    async (salonId: string, serviceIds: string[], chosenLaneId?: string) => {
      // Exactly the call it always was, unless the customer picked a barber.
      const key = getJoinKey(salonId);
      const ticket = chosenLaneId
        ? await joinSalonQueue(salonId, key, serviceIds, chosenLaneId)
        : await joinSalonQueue(salonId, key, serviceIds);
      saveTicket({
        ticketId: ticket.ticketId,
        accessToken: ticket.accessToken,
        salonId: ticket.salonId ?? salonId,
        tokenNumber: ticket.tokenNumber,
      });
      clearJoinKey(salonId);
      navigate(ticketUrl(ticket.ticketId, ticket.accessToken), { replace: true });
      return ticket;
    },
    [navigate],
  );

  const runOnce = useCallback(async () => {
    setView({ kind: 'working' });
    let salonName: string | undefined;
    try {
      const salon = await fetchSalonByCode(code ?? '');
      salonName = salon.name;
      setView({ kind: 'working', salonName });

      await withSalonLock(salon.id, async () => {
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

        const [services, lanes] = await Promise.all([
          fetchSalonServices(salon.id),
          loadLanes(salon.id), // never blocks a join
        ]);
        // The barber choice only appears when the salon has more than one barber.
        const pickBarber = lanes.length > 1;
        if (services.length > 0 || pickBarber) {
          setLaneId(null);
          setView({
            kind: 'choose',
            salon: { id: salon.id, name: salon.name },
            services,
            lanes: pickBarber ? lanes : [],
          });
          return; // the lock is released while the customer chooses
        }
        await joinNow(salon.id, []);
      });
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
  }, [code, navigate, joinNow]);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      await runOnce();
    } finally {
      running.current = false;
    }
  }, [runOnce]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  function onChoose(serviceIds: string[]) {
    if (view.kind !== 'choose' || joining) return;
    const alerts = askPushPermission(); // must start straight from the tap, before any await
    const { salon, services, lanes } = view;
    setJoining(true);

    void (async () => {
      try {
        const ticket = await withSalonLock(salon.id, () => joinNow(salon.id, serviceIds, laneId ?? undefined));
        void alerts
          .then((p) => {
            if (p === 'granted') return enablePushAfterJoin(ticket.ticketId, ticket.accessToken);
          })
          .catch(() => {}); // the Notify me button on the ticket is the fallback
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : 'We could not reach the server. Please check your internet connection and try again.';
        // A service or a barber may have been removed meanwhile: show the current lists with the message.
        let fresh = services;
        let freshLanes = lanes;
        try {
          fresh = await fetchSalonServices(salon.id);
        } catch {
          /* keep the old list */
        }
        try {
          freshLanes = await fetchSalonLanes(salon.id);
        } catch {
          /* keep the old list */
        }
        if (laneId && !freshLanes.some((l) => l.id === laneId)) setLaneId(null);
        setView({
          kind: 'choose',
          salon,
          services: fresh,
          lanes: freshLanes.length > 1 ? freshLanes : [],
          error: message,
        });
      } finally {
        setJoining(false);
      }
    })();
  }

  if (view.kind === 'choose') {
    return (
      <PageShell title={view.services.length > 0 ? 'Choose your service' : 'Get your token'}>
        <p className="mb-1 text-sm text-gray-600">{view.salon.name}</p>
        {view.lanes.length > 1 && (
          <LanePicker lanes={view.lanes} value={laneId} onChange={setLaneId} disabled={joining} />
        )}
        {view.services.length > 0 ? (
          <>
            <h1 className="mb-4 text-xl font-semibold">Choose your service</h1>
            <ServicePicker services={view.services} busy={joining} error={view.error} onJoin={onChoose} />
          </>
        ) : (
          <>
            {view.error && (
              <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                {view.error}
              </p>
            )}
            <button type="button" className="btn-primary" disabled={joining} onClick={() => onChoose([])}>
              {joining ? 'Getting your token...' : 'Get my token'}
            </button>
          </>
        )}
      </PageShell>
    );
  }

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