// frontend/src/components/CustomerDetailsForm.tsx
// First visit to a salon: name, mobile number and a consent tick. Kept in memory only, never in storage.
import { useId, useState, type FormEvent } from 'react';
import { normalizeIndianMobile } from '../lib/phone';
import { useT } from '../lib/i18n';

export interface CustomerDetails {
  name: string;
  phone: string; // already normalised to 10 digits
}

const INPUT =
  'w-full min-h-12 rounded-xl border-2 border-gray-300 bg-white px-4 text-base focus:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const TEXT = {
  hi: {
    thisSalon: 'यह सैलून',
    intro: (s: string) =>
      `कोई अकाउंट नहीं चाहिए। ${s} आपकी जानकारी सिर्फ़ अपनी लाइन और ग्राहक सूची के लिए रखता है। आप इसे कभी भी अपने टोकन पेज से हटा सकते हैं।`,
    name: 'आपका नाम',
    phone: 'मोबाइल नंबर',
    phoneError: '10 अंकों का सही मोबाइल नंबर डालें।',
    consent: (s: string) => `${s} मेरा नाम और नंबर अपनी ग्राहक सूची में सेव करेगा।`,
    continue: 'आगे बढ़ें',
    busy: 'टोकन ले रहे हैं...',
    ready: 'साइन-अप की ज़रूरत नहीं। हम सूचना भेजने की अनुमति माँग सकते हैं।',
    missing: (items: string[]) => `अभी चाहिए: ${items.join(', ')}।`,
    needName: 'आपका नाम',
    needPhone: '10 अंकों का मोबाइल नंबर',
    needTick: 'टिक बॉक्स',
  },
  en: {
    thisSalon: 'This salon',
    intro: (s: string) =>
      `No account needed. ${s} keeps your details only to run its queue and its customer list. You can remove them any time from your ticket page.`,
    name: 'Your name',
    phone: 'Mobile number',
    phoneError: 'Enter a valid 10-digit mobile number.',
    consent: (s: string) => `${s} will save my name and number to its customer list.`,
    continue: 'Continue',
    busy: 'Getting your token...',
    ready: 'No sign-up needed. We may ask to send you alerts.',
    missing: (items: string[]) => `Still needed: ${items.join(', ')}.`,
    needName: 'your name',
    needPhone: 'a 10-digit mobile number',
    needTick: 'the tick box',
  },
};

export default function CustomerDetailsForm({
  salonName,
  busy = false,
  error,
  submitLabel,
  onSubmit,
}: {
  salonName?: string;
  busy?: boolean;
  error?: string;
  submitLabel?: string;
  onSubmit: (details: CustomerDetails) => void;
}) {
  const t = useT(TEXT);
  const uid = useId();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);

  const salon = salonName ?? t.thisSalon;
  const cleanName = name.trim().replace(/\s+/g, ' ');
  const mobile = normalizeIndianMobile(phone);
  const ready = cleanName.length > 0 && mobile !== null && consent;
  const phoneProblem = phoneTouched && phone.trim() !== '' && mobile === null;

  const missing: string[] = [];
  if (!cleanName) missing.push(t.needName);
  if (!mobile) missing.push(t.needPhone);
  if (!consent) missing.push(t.needTick);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    onSubmit({ name: cleanName, phone: mobile as string });
  }

  return (
    <form onSubmit={submit} noValidate>
      <p className="mb-4 text-sm text-gray-700">{t.intro(salon)}</p>

      <div className="mb-4">
        <label htmlFor={`${uid}-name`} className="mb-1 block text-sm font-semibold text-gray-800">
          {t.name}
        </label>
        <input
          id={`${uid}-name`}
          type="text"
          className={INPUT}
          value={name}
          maxLength={80}
          autoComplete="name"
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="mb-4">
        <label htmlFor={`${uid}-phone`} className="mb-1 block text-sm font-semibold text-gray-800">
          {t.phone}
        </label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-base font-semibold text-gray-700">+91</span>
          <input
            id={`${uid}-phone`}
            type="tel"
            inputMode="numeric"
            className={INPUT}
            value={phone}
            maxLength={17}
            autoComplete="tel-national"
            disabled={busy}
            aria-invalid={phoneProblem}
            aria-describedby={phoneProblem ? `${uid}-phone-error` : undefined}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setPhoneTouched(true)}
          />
        </div>
        {phoneProblem && (
          <p id={`${uid}-phone-error`} role="alert" className="mt-1 text-sm text-red-700">
            {t.phoneError}
          </p>
        )}
      </div>

      <label className="mb-4 flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border-2 border-gray-300 bg-white p-3">
        <input
          type="checkbox"
          className="mt-0.5 h-6 w-6 shrink-0"
          checked={consent}
          disabled={busy}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span className="text-sm text-gray-900">{t.consent(salon)}</span>
      </label>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={!ready || busy} aria-busy={busy} aria-describedby={`${uid}-hint`}>
        {busy ? t.busy : (submitLabel ?? t.continue)}
      </button>
      <p id={`${uid}-hint`} className="mt-3 text-center text-xs text-gray-600">
        {ready ? t.ready : t.missing(missing)}
      </p>
    </form>
  );
}
