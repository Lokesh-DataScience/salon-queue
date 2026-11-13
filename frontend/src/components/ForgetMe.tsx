// frontend/src/components/ForgetMe.tsx
// "Remove my details from this salon": deletes this customer's row in THIS salon's list.
// The ticket (their place in the queue) is untouched.
import { useState } from 'react';
import { forgetMyDetails } from '../api/tickets';
import { ApiError } from '../api/client';
import { clearRememberToken } from '../lib/rememberToken';
import { useT } from '../lib/i18n';

const TEXT = {
  hi: {
    open: 'इस सैलून से मेरी जानकारी हटाएँ',
    confirmLabel: 'जानकारी हटाने की पुष्टि करें',
    confirm: 'इस सैलून की ग्राहक सूची से अपना नाम और नंबर हटाएँ? लाइन में आपकी जगह बनी रहेगी। अगली बार ये फिर से भरने होंगे।',
    yes: 'हाँ, हटाएँ',
    removing: 'हटा रहे हैं...',
    keep: 'रहने दें',
    done: 'आपका नाम और नंबर अब इस सैलून में सेव नहीं है।',
    failed: 'जानकारी नहीं हट पाई। फिर से कोशिश करें।',
  },
  en: {
    open: 'Remove my details from this salon',
    confirmLabel: 'Confirm removing your details',
    confirm:
      "Remove your name and number from this salon's customer list? You keep your place in the queue. Next time you will need to enter them again.",
    yes: 'Yes, remove',
    removing: 'Removing...',
    keep: 'Keep',
    done: 'Your name and number are no longer saved at this salon.',
    failed: 'We could not remove your details. Please try again.',
  },
};

export default function ForgetMe({
  ticketId,
  accessToken,
  salonId,
}: {
  ticketId: string;
  accessToken: string;
  salonId: string;
}) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'done'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT(TEXT);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await forgetMyDetails(ticketId, accessToken);
      clearRememberToken(salonId);
      setStep('done');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Nothing saved here any more (already removed, or the salon deleted them): same outcome.
        clearRememberToken(salonId);
        setStep('done');
      } else {
        setError(t.failed);
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <p role="status" className="text-center text-sm text-gray-700">
        {t.done}
      </p>
    );
  }

  if (step === 'confirm') {
    return (
      <div role="alertdialog" aria-label={t.confirmLabel} className="rounded-xl border border-gray-300 bg-white p-4">
        <p className="mb-3 text-sm text-gray-900">{t.confirm}</p>
        <div className="flex gap-3">
          <button type="button" className="btn-danger flex-1" disabled={busy} onClick={() => void remove()}>
            {busy ? t.removing : t.yes}
          </button>
          <button type="button" className="btn-secondary flex-1" disabled={busy} onClick={() => setStep('idle')}>
            {t.keep}
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="text-center">
      <button type="button" className="min-h-11 text-sm text-gray-700 underline" onClick={() => setStep('confirm')}>
        {t.open}
      </button>
    </div>
  );
}