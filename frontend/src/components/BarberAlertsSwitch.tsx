// frontend/src/components/BarberAlertsSwitch.tsx
// Settings: "New customer alerts" on this phone, plus a test button.
// Every staff member turns it on for themselves; it alerts when a customer joins by QR or app.
import { useEffect, useState } from 'react';
import {
  getBarberAlertsState,
  enableBarberAlerts,
  disableBarberAlerts,
  sendBarberTestAlert,
  type BarberAlertsState,
} from '../lib/barberPush';

const rowClass = 'flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-soft';
const TITLE = 'New customer alerts (नए ग्राहक की सूचना)';

const INFO: Partial<Record<BarberAlertsState, string>> = {
  unsupported: "This phone or browser can't show alerts. Open the app in Chrome.",
  'ios-install': 'On iPhone: tap Share, then "Add to Home Screen", and open the app from there.',
  unavailable: 'Alerts are not available right now.',
  blocked:
    'Alerts are blocked for this app. Open your phone Settings → Apps → this app → Notifications, allow them, then come back.',
};

export default function BarberAlertsSwitch() {
  const [state, setState] = useState<BarberAlertsState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getBarberAlertsState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState('unavailable'));
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'loading') return null;

  if (state !== 'on' && state !== 'off') {
    return (
      <section aria-labelledby="alerts-title" className="card px-4 py-3">
        <h2 id="alerts-title" className="text-base font-semibold">{TITLE}</h2>
        <p className="text-sm text-gray-600">{INFO[state]}</p>
      </section>
    );
  }

  const on = state === 'on';

  function toggle() {
    if (busy) return;
    setError(null);
    setNote(null);
    setBusy(true);
    // enableBarberAlerts is called synchronously inside the tap, so the permission prompt can show.
    const work = on
      ? disableBarberAlerts().then(() => setState('off'))
      : enableBarberAlerts().then((r) => {
          if (r === 'on') setState('on');
          else if (r === 'blocked') setState('blocked');
          else setError('Alerts were not allowed. Tap again and choose Allow.');
        });
    work
      .catch((err: Error) =>
        setError(
          err?.name === 'AbortError'
            ? "This browser's notification service is off. Use Chrome, or in Brave turn on \"Use Google services for push messaging\" in Settings → Privacy."
            : err.message || 'Something went wrong. Please try again.',
        ),
      )
      .finally(() => setBusy(false));
  }

  function test() {
    if (busy) return;
    setError(null);
    setNote(null);
    setBusy(true);
    sendBarberTestAlert()
      .then(() => setNote('Test sent. It should appear in a few seconds.'))
      .catch((err: Error) => setError(err.message || 'The test could not be sent.'))
      .finally(() => setBusy(false));
  }

  return (
    <div className="card overflow-hidden p-0">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="New customer alerts"
        disabled={busy}
        onClick={toggle}
        className={rowClass}
      >
        <span>
          <span className="block text-base font-semibold">{TITLE}</span>
          <span className="block text-sm text-gray-600">
            {on ? 'On: this phone alerts you when a customer takes a token' : 'Off: no alerts on this phone'}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`relative h-7 w-12 shrink-0 rounded-full border-2 border-ink transition-colors ${on ? 'bg-brand' : 'bg-gray-200'}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink transition-all ${on ? 'left-[1.4rem]' : 'left-0.5'}`}
          />
        </span>
      </button>
      {on && (
        <div className="border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={test}
            disabled={busy}
            className="min-h-11 rounded-xl border-2 border-ink px-4 text-sm font-bold hover:bg-brand-soft disabled:opacity-60"
          >
            Send test alert
          </button>
        </div>
      )}
      {note && (
        <p role="status" className="border-t border-gray-200 px-4 py-2 text-sm text-gray-700">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
          {error}
        </p>
      )}
    </div>
  );
}
