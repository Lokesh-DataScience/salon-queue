// frontend/src/pages/QueueTracking.tsx
// The customer's ticket page (/tickets/:ticketId?accessToken=...), for wall-QR and app customers alike.
// Hindi by default with an EN switch. Live over the socket; full-screen alert when called.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { fetchTicketStatus, leaveTicket } from '../api/tickets';
import { socket } from '../lib/socket';
import { ApiError } from '../api/client';
import { saveTicket, removeTicket } from '../lib/activeTickets';
import { saveMySalon } from '../lib/mySalons';
import NotifyMe from '../components/NotifyMe';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import Icon from '../components/Icon';
import { CUSTOMER_DISCOVERY } from '../lib/features';
import LocalNews from '../components/LocalNews';
import Countdown from '../components/Countdown';
import ForgetMe from '../components/ForgetMe';
import TurnAlert from '../components/TurnAlert';
import ShareTicket from '../components/ShareTicket';
import { isInstalledApp } from '../lib/appManifest';
import InstallAppBanner from '../components/InstallAppBanner';
import { useT } from '../lib/i18n';

type SanitizedQueueEntry = { id: string; tokenNumber: number; status: string };
type SanitizedQueueState = {
  salonId: string;
  currentToken: number;
  queueStatus: string;
  averageServiceMinutes: number;
  entries: SanitizedQueueEntry[];
};

const FINISHED = ['COMPLETED', 'SKIPPED', 'CANCELLED'];

const TEXT = {
  hi: {
    title: 'मेरा टोकन',
    loading: 'आपका टोकन देख रहे हैं...',
    notFound: 'यह टोकन नहीं मिला। शायद इसका समय खत्म हो गया, या लिंक अधूरा है।',
    mySalons: 'मेरे सैलून',
    findSalon: 'सैलून खोजें',
    home: 'होम पर जाएँ',
    completed: 'आपकी सेवा पूरी हुई। धन्यवाद!',
    skipped: 'सैलून ने आपकी बारी छोड़ दी। अगर यह गलती लगे, तो कृपया सैलून के स्टाफ़ से बात करें।',
    cancelled: 'आपने लाइन छोड़ दी।',
    yourToken: 'आपका टोकन',
    withBarber: (n: string) => `${n} के साथ`,
    pillWaiting: 'इंतज़ार में',
    pillTurn: 'आपकी बारी',
    paused: 'सैलून ने अभी लाइन रोकी हुई है। आपकी जगह सुरक्षित है।',
    movedAhead: 'किसी ज़रूरी ग्राहक को आपसे आगे किया गया है।',
    turn: 'आपकी बारी है',
    turnDetail: 'कृपया अभी काउंटर पर आएँ।',
    turnServing: 'कृपया काउंटर पर आएँ। आपकी सेवा का समय चल रहा है।',
    next: 'आप अगले हैं',
    nextDetail: 'सैलून की ओर चलना शुरू करें।',
    close: 'आपकी बारी करीब है',
    closeDetail: 'आपसे पहले बस एक व्यक्ति है।',
    timeLeft: 'आपकी सेवा का बचा समय',
    yourServices: 'आपकी सेवाएँ',
    min: (m: number) => `${m} मिनट`,
    totalTime: (m: number) => `कुल समय: ~${m} मिनट`,
    nowServing: 'अभी चल रहा',
    ahead: (n: number) => `आपसे पहले ${n} ${n === 1 ? 'व्यक्ति' : 'लोग'}`,
    wait: (m: number) => `अनुमानित इंतज़ार: ~${m} मिनट`,
    keepOpen: 'यह पेज खुला रखें। लाइन चलने पर यह अपने-आप अपडेट होता है।',
    canClose: 'आप यह पेज बंद कर सकते हैं। इंटरनेट चालू रखें, बारी पास आने पर हम बताएँगे।',
    leave: 'लाइन छोड़ें',
    leaveLabel: 'लाइन छोड़ने की पुष्टि करें',
    leaveConfirm: 'लाइन छोड़ें? आपकी जगह चली जाएगी।',
    leaveYes: 'हाँ, छोड़ें',
    leaving: 'छोड़ रहे हैं...',
    stay: 'रुकें',
    leaveFailed: 'लाइन नहीं छोड़ पाए। फिर से कोशिश करें।',
    tabTurn: (n: number) => `आपकी बारी! #${n}`,
    tabClose: (n: number) => `बारी करीब · #${n}`,
    rewardLabel: 'आपका इनाम',
    rewardClaimed: 'इनाम मिल गया',
    rewardTitle: 'आपके लिए एक सरप्राइज़ इनाम!',
    reveal: 'देखने के लिए दबाएँ',
    youWon: 'आप जीते',
    rewardDone: 'अगर इनाम नहीं मिला, तो कृपया बार्बर को बताएँ।',
    rewardNow: 'बार्बर आपका इनाम देख सकते हैं और सेवा के दौरान देंगे।',
    rewardLater: 'आपकी सेवा शुरू होते ही बार्बर यह इनाम देखेंगे। यह सिर्फ़ आज के लिए है।',
  },
  en: {
    title: 'Your ticket',
    loading: 'Loading your queue ticket...',
    notFound: "We couldn't find this queue ticket. It may have expired, or the link is incomplete.",
    mySalons: 'My salons',
    findSalon: 'Find a salon',
    home: 'Back to home',
    completed: 'Your service is complete. Thank you!',
    skipped: 'The salon skipped your turn. If this looks like a mistake, please speak to the salon staff.',
    cancelled: 'You left the queue.',
    yourToken: 'Your token',
    withBarber: (n: string) => `with ${n}`,
    pillWaiting: 'Waiting',
    pillTurn: 'Your turn',
    paused: 'The salon has paused the queue for now. Your place is saved.',
    movedAhead: 'A customer with an urgent need was moved ahead of you.',
    turn: "It's your turn",
    turnDetail: 'Please head to the counter now.',
    turnServing: 'Please head to the counter now. Your service time is running.',
    next: "You're next",
    nextDetail: 'Start making your way to the salon.',
    close: "You're getting close",
    closeDetail: 'Only one person is ahead of you.',
    timeLeft: 'Time left for your service',
    yourServices: 'Your services',
    min: (m: number) => `${m} min`,
    totalTime: (m: number) => `Total time: ~${m} min`,
    nowServing: 'Now serving',
    ahead: (n: number) => `${n} ${n === 1 ? 'person' : 'people'} ahead`,
    wait: (m: number) => `Estimated wait: ~${m} min`,
    keepOpen: 'Keep this page open. It updates live as the queue moves.',
    canClose: "You can close this page. Keep your internet on and we'll alert you as your turn gets close.",
    leave: 'Leave queue',
    leaveLabel: 'Confirm leaving the queue',
    leaveConfirm: 'Leave the queue? You will lose your place.',
    leaveYes: 'Yes, leave',
    leaving: 'Leaving...',
    stay: 'Stay',
    leaveFailed: 'Unable to leave the queue. Please try again.',
    tabTurn: (n: number) => `Your turn! #${n}`,
    tabClose: (n: number) => `Almost your turn · #${n}`,
    rewardLabel: 'Your reward',
    rewardClaimed: 'Reward claimed',
    rewardTitle: '🎁 You have a surprise reward!',
    reveal: 'Tap to reveal',
    youWon: 'You won',
    rewardDone: 'If you did not get your reward, please tell the barber.',
    rewardNow: 'Your barber can see your reward and will give it to you during your service.',
    rewardLater: 'Your barber will see this reward once your service starts. It is valid today only.',
  },
};

function PrizeCard({ prize, status }: { prize: { name: string; redeemed: boolean }; status: string }) {
  const t = useT(TEXT);
  const [revealed, setRevealed] = useState(false);

  if (prize.redeemed) {
    return (
      <section aria-label={t.rewardLabel} className="mt-4 rounded-2xl border-2 border-dashed border-ink/50 bg-white p-4 text-center">
        <p className="text-sm font-medium text-gray-600">{t.rewardClaimed}</p>
        <p className="text-lg font-bold text-ink">🎁 {prize.name}</p>
      </section>
    );
  }

  const note =
    status === 'COMPLETED' ? t.rewardDone : status === 'SERVING' || status === 'CALLED' ? t.rewardNow : t.rewardLater;

  return (
    <section
      aria-label={t.rewardLabel}
      className="relative mt-4 overflow-hidden rounded-2xl border-2 border-ink bg-brand-soft p-5 text-center shadow-[0_5px_0_0_var(--color-ink)]"
    >
      {/* Ticket-style notches */}
      <span aria-hidden="true" className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border-2 border-ink bg-paper" />
      <span aria-hidden="true" className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border-2 border-ink bg-paper" />

      {!revealed ? (
        <>
          <p aria-hidden="true" className="text-5xl leading-none">🎁</p>
          <p className="mt-2 text-xl font-extrabold text-ink">{t.rewardTitle}</p>
          <button type="button" className="btn-primary mt-4" onClick={() => setRevealed(true)}>
            {t.reveal}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-bold uppercase tracking-widest text-ink">{t.youWon}</p>
          <p className="mt-1 text-2xl font-extrabold text-ink">🎉 {prize.name}</p>
          <div aria-hidden="true" className="mx-auto my-4 border-t-2 border-dashed border-ink/40" />
          <p className="text-sm text-ink">{note}</p>
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
  const t = useT(TEXT);

  const { data: ticket, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const tk = await fetchTicketStatus(ticketId!, accessToken);
      return tk ? { ...tk, fetchedAt: Date.now() } : tk;
    },
    enabled: !!ticketId && !!accessToken,
  });

  const leave = useMutation({
    mutationFn: () => leaveTicket(ticketId!, accessToken),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, (prev: any) => (prev ? { ...prev, status: 'CANCELLED' } : prev));
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
        // Several barbers: the broadcast mixes every line, so only the server can count this line.
        if (prev.lane) return { ...prev, status: mine.status, queueStatus: state.queueStatus };
        const idx = state.entries.findIndex((e) => e.id === ticketId);
        const peopleAhead = state.entries.slice(0, idx).filter((e) => e.status === 'WAITING').length;
        return {
          ...prev,
          status: mine.status,
          currentToken: state.currentToken,
          queueStatus: state.queueStatus,
          peopleAhead,
        };
      });
      // Wait estimate and countdown come from the server.
      queryClient.invalidateQueries({ queryKey });
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
    if (ticket.status === 'CALLED' || ticket.status === 'SERVING') document.title = t.tabTurn(ticket.tokenNumber);
    else if (ticket.status === 'WAITING' && ticket.peopleAhead <= 1) document.title = t.tabClose(ticket.tokenNumber);
    return () => {
      document.title = original;
    };
  }, [ticket?.status, ticket?.peopleAhead, ticket?.tokenNumber, t]);

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

  // Opening a ticket (in any browser, or in the installed app) adds its salon to "My salons",
  // so the app still lists the salon after this ticket is finished.
  useEffect(() => {
    if (ticket?.salonId && ticket.salonCode && ticket.salonName) {
      saveMySalon({ salonId: ticket.salonId, code: ticket.salonCode, name: ticket.salonName });
    }
  }, [ticket?.salonId, ticket?.salonCode, ticket?.salonName]);

  // Inside the installed customer app, "home" is the My salons list.
  const inApp = isInstalledApp();
  const homeTo = inApp ? '/c' : '/';
  const homeLabel = inApp ? t.mySalons : CUSTOMER_DISCOVERY ? t.findSalon : t.home;
  const header = <CustomerHeader title={t.title} subtitle={ticket?.salonName ?? undefined} />;

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <PageShell title={t.title}>
        {header}
        <div className="animate-pulse space-y-4" aria-hidden="true">
          <div className="h-48 rounded-3xl bg-gray-200" />
          <div className="h-32 rounded-2xl bg-gray-200" />
        </div>
        <p role="status" className="mt-4 text-center text-gray-600">{t.loading}</p>
      </PageShell>
    );
  }

  // ── Missing / invalid ticket ───────────────────────────────────────────
  if (error || !ticket) {
    return (
      <PageShell title={t.title}>
        {header}
        <div className="card flex flex-col items-center p-6 text-center">
          <span aria-hidden="true" className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-ink">
            <Icon name="ticket" size={30} />
          </span>
          <p role="alert" className="text-base text-red-800">{t.notFound}</p>
          <Link to={homeTo} className="btn-secondary mt-6">{homeLabel}</Link>
        </div>
      </PageShell>
    );
  }

  // ── Finished states ────────────────────────────────────────────────────
  if (FINISHED.includes(ticket.status)) {
    const message = ticket.status === 'COMPLETED' ? t.completed : ticket.status === 'SKIPPED' ? t.skipped : t.cancelled;
    const icon = ticket.status === 'COMPLETED' ? '✅' : ticket.status === 'SKIPPED' ? '⏭️' : '👋';
    return (
      <PageShell title={t.title}>
        {header}
        <div className="card p-6 text-center">
          <span aria-hidden="true" className="mb-2 block text-4xl">{icon}</span>
          <p className="text-5xl font-bold tabular-nums text-gray-500">#{ticket.tokenNumber}</p>
          <p className="mt-4 text-lg text-gray-800" role="status">{message}</p>
          {ticket.status === 'COMPLETED' && ticket.prize && <PrizeCard prize={ticket.prize} status={ticket.status} />}
          <div className="text-left">
            <InstallAppBanner />
          </div>
          <div className="mt-6">
            <ForgetMe ticketId={ticket.ticketId} accessToken={accessToken} salonId={ticket.salonId} />
          </div>
          <Link to={homeTo} className="btn-secondary mt-6">{homeLabel}</Link>
        </div>
      </PageShell>
    );
  }

  // ── Status banner (color + icon + text, never color alone) ─────────────
  let banner: { icon: string; text: string; detail: string; classes: string } | null = null;
  if (ticket.status === 'CALLED') {
    banner = { icon: '🔔', text: t.turn, detail: t.turnDetail, classes: 'border-green-400 bg-green-50 text-green-900' };
  } else if (ticket.status === 'SERVING') {
    banner = { icon: '🔔', text: t.turn, detail: t.turnServing, classes: 'border-green-400 bg-green-50 text-green-900' };
  } else if (ticket.status === 'WAITING' && ticket.peopleAhead === 0) {
    banner = { icon: '🚶', text: t.next, detail: t.nextDetail, classes: 'border-amber-400 bg-amber-50 text-amber-900' };
  } else if (ticket.status === 'WAITING' && ticket.peopleAhead === 1) {
    banner = { icon: '⏳', text: t.close, detail: t.closeDetail, classes: 'border-amber-300 bg-amber-50 text-amber-900' };
  }

  const isTurn = ticket.status === 'CALLED' || ticket.status === 'SERVING';
  const canLeave = ticket.status === 'WAITING';
  const leaveError = leave.error ? t.leaveFailed : null;

  return (
    <PageShell title={t.title}>
      {header}
      <TurnAlert ticketId={ticket.ticketId} tokenNumber={ticket.tokenNumber} status={ticket.status} />

      {/* Token */}
      <section
        aria-label={t.yourToken}
        className="flex flex-col items-center rounded-3xl border-2 border-ink bg-white px-6 pb-6 pt-5 text-center text-ink shadow-[0_6px_0_0_var(--color-ink)]"
      >
        <p className="text-base font-semibold text-gray-700">{t.yourToken}</p>
        <p className="my-1 text-8xl font-extrabold leading-none tabular-nums">#{ticket.tokenNumber}</p>
        {ticket.lane && <p className="text-lg font-bold">{t.withBarber(ticket.lane.name)}</p>}
        <span
          className={`mt-3 rounded-full px-4 py-1 text-sm font-bold ${
            isTurn ? 'bg-green-100 text-green-900' : 'bg-brand text-ink'
          }`}
        >
          {isTurn ? t.pillTurn : t.pillWaiting}
        </span>
      </section>

      {/* Right under the token number: get the customer app (hidden inside the app itself). */}
      <InstallAppBanner />

      {ticket.queueStatus === 'PAUSED' && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <span aria-hidden="true">⏸</span>
          <span>{t.paused}</span>
        </p>
      )}
      {ticket.status === 'WAITING' && ticket.movedAhead && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>{t.movedAhead}</span>
        </p>
      )}
      {banner && (
        <div className={`mt-4 flex items-start gap-3 rounded-2xl border-2 p-4 ${banner.classes}`} role="status" aria-live="polite">
          <span aria-hidden="true" className="text-3xl leading-none">{banner.icon}</span>
          <div>
            <p className="text-xl font-semibold">{banner.text}</p>
            <p className="text-sm">{banner.detail}</p>
          </div>
        </div>
      )}

      {ticket.status === 'SERVING' && ticket.remainingSeconds != null && (
        <section aria-label={t.timeLeft} className="card mt-4 p-4 text-center">
          <p className="text-sm text-gray-600">{t.timeLeft}</p>
          <Countdown
            endAtMs={ticket.fetchedAt + ticket.remainingSeconds * 1000}
            onExpired={() => queryClient.invalidateQueries({ queryKey })}
          />
        </section>
      )}

      {/* Live numbers */}
      <section aria-label={t.nowServing} className="card mt-4 divide-y divide-gray-200 p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-base text-gray-700">{t.nowServing}</span>
          <span className="rounded-lg bg-brand-soft px-2 text-2xl font-bold tabular-nums">#{ticket.currentToken}</span>
        </div>
        {ticket.status === 'WAITING' && (
          <>
            <div className="px-4 py-3">
              <p className="text-lg font-semibold">{t.ahead(ticket.peopleAhead)}</p>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 text-base text-gray-700">
              <Icon name="clock" size={18} />
              <p>{t.wait(ticket.estimatedWaitMinutes)}</p>
            </div>
          </>
        )}
      </section>

      {ticket.services?.length > 0 && (
        <section aria-label={t.yourServices} className="card mt-4 p-4">
          <p className="mb-2 text-sm text-gray-600">{t.yourServices}</p>
          <ul className="grid gap-1">
            {ticket.services.map((s: { name: string; durationMinutes: number }) => (
              <li key={s.name} className="flex justify-between gap-3">
                <span className="font-semibold">{s.name}</span>
                <span className="text-sm text-gray-700">{t.min(s.durationMinutes)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-gray-700">{t.totalTime(ticket.durationMinutes)}</p>
        </section>
      )}

      {ticket.prize && <PrizeCard prize={ticket.prize} status={ticket.status} />}

      {ticket.status === 'WAITING' && (
        <NotifyMe ticketId={ticket.ticketId} accessToken={accessToken} enabled={!!ticket.notificationsOn} />
      )}

      {!ticket.notificationsOn ? (
        <p className="mt-4 text-center text-sm text-gray-600">{t.keepOpen}</p>
      ) : (
        ticket.status === 'WAITING' && <p className="mt-4 text-center text-sm text-gray-600">{t.canClose}</p>
      )}

      {ticket.status === 'WAITING' && (
        <div className="mt-6">
          <ShareTicket tokenNumber={ticket.tokenNumber} salonName={ticket.salonName} salonCode={ticket.salonCode} />
        </div>
      )}

      {canLeave && (
        <div className="mt-3">
          {!confirmingLeave ? (
            <button
              type="button"
              onClick={() => setConfirmingLeave(true)}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-red-300 bg-white px-5 py-3 text-base font-semibold text-red-800 hover:bg-red-50"
            >
              <Icon name="exit" size={20} />
              {t.leave}
            </button>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alertdialog" aria-label={t.leaveLabel}>
              <p className="mb-3 text-sm text-red-900">{t.leaveConfirm}</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => leave.mutate()} disabled={leave.isPending} className="btn-danger flex-1">
                  {leave.isPending ? t.leaving : t.leaveYes}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingLeave(false)}
                  disabled={leave.isPending}
                  className="btn-secondary flex-1"
                >
                  {t.stay}
                </button>
              </div>
            </div>
          )}
          {leaveError && <p className="mt-3 text-sm text-red-700" role="alert">{leaveError}</p>}
        </div>
      )}
      <div className="mt-6">
        <ForgetMe ticketId={ticket.ticketId} accessToken={accessToken} salonId={ticket.salonId} />
      </div>
      {ticket.status === 'WAITING' && <LocalNews salonId={ticket.salonId} />}
    </PageShell>
  );
}
