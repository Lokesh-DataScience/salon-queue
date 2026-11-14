// frontend/src/pages/ScanLanding.tsx
// Where a salon's wall QR lands (/q/:code). Resume this phone's active ticket if it has one.
// First visit to a salon: ask for name + number + consent once. After that this phone is remembered
// for THAT salon only, and the details step is skipped.
// Salons with services (or several barbers) show a picker next; salons without join straight away.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchPublicQueue, fetchSalonByCode, fetchSalonLanes, type PublicLane } from '../api/salons';
import { formatDays } from '../lib/salonInfo';
import { fetchSalonServices, type PublicService } from '../api/publicServices';
import { fetchTicketStatus, joinSalonQueue } from '../api/tickets';
import { ApiError } from '../api/client';
import { getTickets, removeTicket, saveTicket } from '../lib/activeTickets';
import { clearJoinKey, getJoinKey } from '../lib/joinKey';
import { clearRememberToken, getRememberToken, saveRememberToken } from '../lib/rememberToken';
import { saveMySalon } from '../lib/mySalons';
import { askPushPermission, enablePushAfterJoin } from '../lib/push';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import { useLang, useT } from '../lib/i18n';
import ServicePicker from '../components/ServicePicker';
import LanePicker from '../components/LanePicker';
import CustomerDetailsForm, { type CustomerDetails } from '../components/CustomerDetailsForm';

const FINISHED = ['COMPLETED', 'SKIPPED', 'CANCELLED'];

// The salon does not know this phone (new here, or the customer/barber removed them): ask for details again.
const DETAILS_CODES = ['CUSTOMER_DETAILS_REQUIRED', 'CONSENT_REQUIRED'];
const needsDetails = (err: unknown) => err instanceof ApiError && !!err.code && DETAILS_CODES.includes(err.code);

// The barber list must never get in the way of taking a token: any failure just means "no choice".
async function loadLanes(salonId: string): Promise<PublicLane[]> {
  try {
    return await fetchSalonLanes(salonId);
  } catch {
    return [];
  }
}

// Is today the salon's weekly off? Returns its off days if so, otherwise null.
// Like the barber list, this must never block a join: any failure means "not an off day",
// and the server still refuses the join if it really is one.
async function offDaysIfClosedToday(salonId: string): Promise<number[] | null> {
  try {
    const q = await fetchPublicQueue(salonId);
    return q.isOffDay ? (q.weeklyOffDays ?? []) : null;
  } catch {
    return null;
  }
}

type SalonInfo = { id: string; name: string };

// Messages are kept as keys (or the server's text + code) and translated when shown,
// so switching the language also switches a message that is already on screen.
type Msg = { key: 'network' | 'again' | 'notRecognisedBody' } | { server: string; code?: string };
const fromError = (err: unknown): Msg =>
  err instanceof ApiError ? { server: err.message, code: err.code } : { key: 'network' };

type View =
  | { kind: 'working'; salonName?: string }
  | { kind: 'details'; salon: SalonInfo; services: PublicService[]; lanes: PublicLane[]; notice?: Msg; error?: Msg }
  | { kind: 'choose'; salon: SalonInfo; services: PublicService[]; lanes: PublicLane[]; error?: Msg }
  | { kind: 'error'; title: 'notRecognised' | 'cantGet' | 'cantOpen'; message: Msg; salonName?: string; canRetry: boolean }
  | { kind: 'offday'; salonName: string; days: number[] };

// Refusals the server marks with a code get our own Hindi text. In English (and for codes we
// don't know) the server's own message is shown.
const HINDI_CODES: Record<string, string> = {
  APP_JOIN_DISABLED: 'इस सैलून में अभी ऐप से टोकन बंद है। कृपया सैलून में लगा QR कोड स्कैन करें।',
  ALREADY_IN_QUEUE: 'इस सैलून में आज आपका टोकन पहले से है। उसे उसी फ़ोन में देखें जिससे टोकन लिया था।',
  SALON_SUSPENDED: 'यह सैलून अभी टोकन नहीं ले रहा है।',
  CONSENT_REQUIRED: 'आगे बढ़ने के लिए कृपया टिक बॉक्स पर निशान लगाएँ।',
  CUSTOMER_DETAILS_REQUIRED: 'कृपया अपना नाम और मोबाइल नंबर भरें।',
  SALON_CLOSED: 'सैलून अभी बंद है।',
};

const TEXT = {
  hi: {
    network: 'सर्वर से जुड़ नहीं पाए। इंटरनेट देखकर फिर से कोशिश करें।',
    again: 'कृपया अपनी जानकारी फिर से भरें।',
    notRecognised: 'QR कोड पहचाना नहीं गया',
    notRecognisedBody: 'कृपया सैलून में लगा QR कोड फिर से स्कैन करें, या स्टाफ़ से मदद लें।',
    cantGet: 'अभी टोकन नहीं मिल सकता',
    cantOpen: 'लाइन नहीं खुल पाई',
    retry: 'फिर से कोशिश करें',
    getToken: 'टोकन लें',
    details: 'आपकी जानकारी',
    choose: 'सेवा चुनें',
    continue: 'आगे बढ़ें',
    getMine: 'मेरा टोकन लें',
    busy: 'टोकन ले रहे हैं...',
    working: 'आपका टोकन ले रहे हैं...',
    wait: 'एक पल रुकें। साइन-अप की ज़रूरत नहीं।',
    offTitle: 'आज सैलून बंद है',
    offBody: (days: string | null) =>
      days
        ? `आज साप्ताहिक छुट्टी है। सैलून हर ${days} को बंद रहता है। किसी और दिन फिर से QR स्कैन करें।`
        : 'आज साप्ताहिक छुट्टी है। किसी और दिन फिर से QR स्कैन करें।',
  },
  en: {
    network: 'We could not reach the server. Please check your internet connection and try again.',
    again: 'Please enter your details again.',
    notRecognised: 'QR code not recognised',
    notRecognisedBody: 'Please scan the QR code displayed at the salon again, or ask the salon staff for help.',
    cantGet: "Can't get a token right now",
    cantOpen: "Couldn't open the queue",
    retry: 'Try again',
    getToken: 'Get your token',
    details: 'Your details',
    choose: 'Choose your service',
    continue: 'Continue',
    getMine: 'Get my token',
    busy: 'Getting your token...',
    working: 'Getting your token...',
    wait: 'Please wait a moment. No sign-up needed.',
    offTitle: 'Closed today',
    offBody: (days: string | null) =>
      days
        ? `Today is the weekly off. The salon is closed every ${days}. Please scan again on another day.`
        : 'Today is the weekly off. Please scan again on another day.',
  },
};

const ticketUrl = (ticketId: string, accessToken: string) =>
  `/tickets/${ticketId}?accessToken=${accessToken}`;

// Two tabs (or a reload) scanning the same salon take turns, so the second one finds the first one's ticket.
async function withSalonLock<T>(salonId: string, fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as unknown as { locks?: { request: <R>(name: string, cb: () => Promise<R>) => Promise<R> } }).locks;
  return locks?.request ? locks.request(`join:${salonId}`, fn) : fn();
}

// source "app": the same flow, started from the customer app's Join button (/c/s/:code/join).
export default function ScanLanding({ source = 'qr' }: { source?: 'qr' | 'app' } = {}) {
  const { code } = useParams<{ code: string }>();
  const lang = useLang();
  const t = useT(TEXT);
  const say = (m: Msg | undefined): string | undefined => {
    if (!m) return undefined;
    if ('key' in m) return t[m.key];
    return (lang === 'hi' && m.code && HINDI_CODES[m.code]) || m.server;
  };
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: 'working' });
  const [joining, setJoining] = useState(false);
  const [laneId, setLaneId] = useState<string | null>(null); // null = Any barber
  // What the customer typed on this visit. Memory only: never written to storage.
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  // React StrictMode runs effects twice in development. This makes sure a scan can never take two tokens.
  const started = useRef(false);
  // A second tap on "Try again" while a request is in flight does nothing.
  const running = useRef(false);

  // The same key for every attempt of this scan, so the server never creates a second ticket for it.
  const joinNow = useCallback(
    async (salonId: string, serviceIds: string[], chosenLaneId?: string, who?: CustomerDetails) => {
      const key = getJoinKey(salonId);
      const ticket = await joinSalonQueue(salonId, key, serviceIds, chosenLaneId, {
        ...(who ? { name: who.name, phone: who.phone, consent: true } : {}),
        rememberToken: getRememberToken(salonId) ?? undefined,
        ...(source === 'app' ? { source: 'app' as const } : {}),
      });
      // The server hands out a token only when this phone is new to the salon (or on a new device).
      if (ticket.rememberToken) saveRememberToken(salonId, ticket.rememberToken);
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
    [navigate, source],
  );

  const runOnce = useCallback(async () => {
    setView({ kind: 'working' });
    let salonName: string | undefined;
    try {
      const salon = await fetchSalonByCode(code ?? '');
      salonName = salon.name;
      setView({ kind: 'working', salonName });
      // Remember the salon for the customer app's "My salons" (salon details only, nothing about the customer).
      saveMySalon({ salonId: salon.id, code: code ?? '', name: salon.name });

      // Started now so it runs alongside the ticket check below (it never throws).
      const offCheck = offDaysIfClosedToday(salon.id);

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

        // Weekly off day: say so plainly instead of asking for details that would only be refused.
        // (Checked after the resume above, so a ticket this phone already holds still opens.)
        const offDays = await offCheck;
        if (offDays) {
          setView({ kind: 'offday', salonName: salon.name, days: offDays });
          return;
        }

        const [services, lanes] = await Promise.all([
          fetchSalonServices(salon.id),
          loadLanes(salon.id), // never blocks a join
        ]);
        // The barber choice only appears when the salon has more than one barber.
        const pickBarber = lanes.length > 1;
        const info: SalonInfo = { id: salon.id, name: salon.name };

        // First visit to this salon from this phone: details first.
        if (!getRememberToken(salon.id)) {
          setDetails(null);
          setLaneId(null);
          setView({ kind: 'details', salon: info, services, lanes: pickBarber ? lanes : [] });
          return; // the lock is released while the customer types
        }

        if (services.length > 0 || pickBarber) {
          setLaneId(null);
          setView({ kind: 'choose', salon: info, services, lanes: pickBarber ? lanes : [] });
          return; // the lock is released while the customer chooses
        }
        try {
          await joinNow(salon.id, []);
        } catch (err) {
          if (!needsDetails(err)) throw err;
          // This phone's token is no longer known to the salon: forget it and ask again.
          clearRememberToken(salon.id);
          setView({
            kind: 'details',
            salon: info,
            services,
            lanes: [],
            notice: { key: 'again' },
          });
        }
      });
    } catch (err) {
      if (!salonName && err instanceof ApiError && err.status === 404) {
        setView({ kind: 'error', title: 'notRecognised', message: { key: 'notRecognisedBody' }, canRetry: false });
        return;
      }
      setView({
        kind: 'error',
        title: salonName ? 'cantGet' : 'cantOpen',
        message: fromError(err),
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

  // Takes the token. Used by the details form (no services, one barber) and by the picker.
  function startJoin(
    salon: SalonInfo,
    services: PublicService[],
    lanes: PublicLane[],
    serviceIds: string[],
    who?: CustomerDetails,
  ) {
    if (joining) return;
    const alerts = askPushPermission(); // must start straight from the tap, before any await
    setJoining(true);

    void (async () => {
      try {
        const ticket = await withSalonLock(salon.id, () => joinNow(salon.id, serviceIds, laneId ?? undefined, who));
        void alerts
          .then((p) => {
            if (p === 'granted') return enablePushAfterJoin(ticket.ticketId, ticket.accessToken);
          })
          .catch(() => {}); // the Notify me button on the ticket is the fallback
      } catch (err) {
        const message = fromError(err);
        if (needsDetails(err)) {
          clearRememberToken(salon.id);
          setDetails(null);
          setView({
            kind: 'details',
            salon,
            services,
            lanes,
            notice: who ? undefined : { key: 'again' },
            error: who ? message : undefined,
          });
          return;
        }
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

  function onDetails(d: CustomerDetails) {
    if (view.kind !== 'details' || joining) return;
    const { salon, services, lanes } = view;
    setDetails(d);
    if (services.length > 0 || lanes.length > 1) {
      setLaneId(null);
      setView({ kind: 'choose', salon, services, lanes });
      return;
    }
    startJoin(salon, services, lanes, [], d); // nothing more to choose: take the token now
  }

  function onChoose(serviceIds: string[]) {
    if (view.kind !== 'choose') return;
    startJoin(view.salon, view.services, view.lanes, serviceIds, details ?? undefined);
  }

  if (view.kind === 'details') {
    const more = view.services.length > 0 || view.lanes.length > 1;
    return (
      <PageShell title={t.details}>
        <CustomerHeader title={t.details} subtitle={view.salon.name} />
        {view.notice && (
          <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {say(view.notice)}
          </p>
        )}
        <CustomerDetailsForm
          salonName={view.salon.name}
          busy={joining}
          error={say(view.error)}
          submitLabel={more ? t.continue : t.getMine}
          onSubmit={onDetails}
        />
      </PageShell>
    );
  }

  if (view.kind === 'choose') {
    const title = view.services.length > 0 ? t.choose : t.getToken;
    return (
      <PageShell title={title}>
        <CustomerHeader title={title} subtitle={view.salon.name} />
        {view.lanes.length > 1 && (
          <LanePicker lanes={view.lanes} value={laneId} onChange={setLaneId} disabled={joining} />
        )}
        {view.services.length > 0 ? (
          <ServicePicker services={view.services} busy={joining} error={say(view.error)} onJoin={onChoose} />
        ) : (
          <>
            {view.error && (
              <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                {say(view.error)}
              </p>
            )}
            <button type="button" className="btn-primary" disabled={joining} onClick={() => onChoose([])}>
              {joining ? t.busy : t.getMine}
            </button>
          </>
        )}
      </PageShell>
    );
  }

  if (view.kind === 'offday') {
    return (
      <PageShell title={t.offTitle}>
        <CustomerHeader title={t.offTitle} subtitle={view.salonName} />
        <div className="flex min-h-[50dvh] flex-col justify-center text-center">
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
            {t.offBody(formatDays(view.days, lang))}
          </p>
        </div>
      </PageShell>
    );
  }

  if (view.kind === 'error') {
    return (
      <PageShell title={t.getToken}>
        <CustomerHeader title={t[view.title]} subtitle={view.salonName} />
        <div className="flex min-h-[50dvh] flex-col justify-center text-center">
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-base text-red-900">
            {say(view.message)}
          </p>
          {view.canRetry && (
            <button type="button" onClick={() => void run()} className="btn-primary mt-6">
              {t.retry}
            </button>
          )}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={t.getToken}>
      <CustomerHeader title={t.getToken} subtitle={view.salonName} />
      <div className="flex min-h-[50dvh] flex-col items-center justify-center text-center">
        <span aria-hidden="true" className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-ink" />
        <p className="text-xl font-semibold">{t.working}</p>
        <p role="status" className="mt-2 text-gray-600">{t.wait}</p>
      </div>
    </PageShell>
  );
}
