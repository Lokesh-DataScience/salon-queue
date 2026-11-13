// frontend/src/components/TurnAlert.tsx
// Full-screen "your turn" alert on the ticket page, with a beep and vibration, the moment the
// barber calls this token while the page (or the installed app) is open. Shown once per ticket
// per tab. Push notifications still cover the case where the page is closed.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';

const TEXT = {
  hi: { title: 'आपकी बारी!', token: (n: number) => `टोकन #${n}`, body: 'कृपया अभी काउंटर पर आएँ।', ok: 'ठीक है, आ रहा हूँ' },
  en: { title: 'Your turn now!', token: (n: number) => `Token #${n}`, body: 'Please come to the counter now.', ok: "OK, I'm coming" },
};

const seenKey = (ticketId: string) => `svq.turnAlert.${ticketId}`;

function alreadyShown(ticketId: string): boolean {
  try {
    return sessionStorage.getItem(seenKey(ticketId)) === '1';
  } catch {
    return false;
  }
}

function markShown(ticketId: string) {
  try {
    sessionStorage.setItem(seenKey(ticketId), '1');
  } catch {
    /* storage blocked: it may show again after a reload, which is harmless */
  }
}

// Three short beeps. Browsers may block sound until the page has been tapped once; then this is silent.
function beep() {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume?.();
    for (const at of [0, 0.45, 0.9]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.start(t0);
      osc.stop(t0 + 0.35);
    }
    setTimeout(() => void ctx.close?.(), 2000);
  } catch {
    /* no sound available: the screen and vibration still work */
  }
}

function vibrate() {
  try {
    navigator.vibrate?.([400, 200, 400, 200, 800]);
  } catch {
    /* not supported */
  }
}

export default function TurnAlert({ ticketId, tokenNumber, status }: { ticketId: string; tokenNumber: number; status: string }) {
  const t = useT(TEXT);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (status !== 'CALLED' || alreadyShown(ticketId)) return;
    markShown(ticketId);
    setOpen(true);
    vibrate();
    beep();
  }, [status, ticketId]);

  useEffect(() => {
    if (open) button.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="turn-alert-title"
      aria-describedby="turn-alert-body"
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-green-800 p-6 text-center text-white"
    >
      <p id="turn-alert-title" className="text-4xl font-extrabold">{t.title}</p>
      <p className="text-6xl font-extrabold tabular-nums">{t.token(tokenNumber)}</p>
      <p id="turn-alert-body" className="text-xl">{t.body}</p>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(false)}
        className="mt-4 inline-flex min-h-14 w-full max-w-xs items-center justify-center rounded-xl border-2 border-white bg-white px-5 text-lg font-bold text-green-900"
      >
        {t.ok}
      </button>
    </div>
  );
}
