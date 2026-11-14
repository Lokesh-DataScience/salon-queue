// frontend/src/pages/BarberRegister.tsx
// Salon sign-up. Order: salon name, salon mobile (also the owner's login), "Fill automatically",
// address, district, state, your name, password, confirm password.
// The barber never sees latitude/longitude. Location permission is asked when they tap
// "Fill automatically", or else when they tap Register; if they deny it, the salon is
// registered without a location. Hours and service time use the defaults (changed in Settings).
// Hindi by default, EN/हिं switch at the top (svq.lang.v1).
import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, InputHTMLAttributes } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerSalon } from '../api/barber';
import { reverseGeocode, type GeoPlace } from '../api/feed';
import { ApiError } from '../api/client';
import PageShell from '../components/PageShell';
import BrandMark from '../components/BrandMark';
import LangToggle from '../components/LangToggle';
import { useT } from '../lib/i18n';
import { normalizeIndianMobile } from '../lib/phone';

// Same values the backend uses when these are left out.
const DEFAULT_HOURS = { openingTime: '09:00', closingTime: '21:00', averageServiceMinutes: 15 } as const;
const MIN_PASSWORD = 6; // keep in step with registerSalonBodySchema

type Form = {
  salonName: string;
  phone: string;
  address: string;
  district: string;
  state: string;
  ownerName: string;
  password: string;
  confirm: string;
};
type FieldKey = keyof Form;
type Coords = { lat: number; lng: number };

const FIELD_ORDER: FieldKey[] = [
  'salonName', 'phone', 'address', 'district', 'state', 'ownerName', 'password', 'confirm',
];
const AUTO_FIELDS = ['address', 'district', 'state'] as const;

const EMPTY: Form = {
  salonName: '', phone: '', address: '', district: '', state: '', ownerName: '', password: '', confirm: '',
};

const TEXT = {
  hi: {
    pageTitle: 'सैलून रजिस्टर करें',
    intro: '2 मिनट का काम है। इसके बाद आपको दुकान पर लगाने के लिए QR कोड मिलेगा।',
    step1: '1. आपका सैलून',
    step2: '2. आपकी जानकारी',
    salonName: 'सैलून का नाम',
    salonNameHint: 'ग्राहकों को यही नाम दिखेगा।',
    phone: 'सैलून का मोबाइल नंबर',
    phoneHint: 'इसी नंबर से लॉगिन करेंगे। यह QR के नीचे भी छपेगा।',
    fill: '📍 अपने-आप भरें',
    fillHint: 'सैलून में खड़े होकर दबाएं। फ़ोन लोकेशन की अनुमति मांगेगा।',
    locating: 'लोकेशन ले रहे हैं...',
    located: 'लोकेशन मिल गई',
    lookingUp: 'पता ढूंढ रहे हैं...',
    denied: 'लोकेशन नहीं मिली। कोई बात नहीं, पता खुद लिख दें।',
    addressMissing: 'पूरा पता अपने-आप नहीं मिला। कृपया खुद लिख दें।',
    address: 'सैलून का पता',
    addressHint: 'जैसे: मेन रोड, बस स्टैंड के पास',
    district: 'जिला',
    state: 'राज्य',
    autoHint: 'अपने-आप भरेगा',
    ownerName: 'आपका नाम',
    password: 'पासवर्ड',
    passwordHint: 'कम से कम 6 अक्षर। इसे याद रखें।',
    confirm: 'पासवर्ड दोबारा लिखें',
    showPassword: 'पासवर्ड दिखाएं',
    hidePassword: 'पासवर्ड छुपाएं',
    show: 'दिखाएं',
    hide: 'छुपाएं',
    laterNote: 'खुलने-बंद होने का समय (अभी सुबह 9 से रात 9) बाद में सेटिंग्स में बदल सकते हैं।',
    submit: 'सैलून रजिस्टर करें',
    submittingLocation: 'लोकेशन ले रहे हैं...',
    submitting: 'सैलून बना रहे हैं...',
    haveAccount: 'पहले से रजिस्टर हैं?',
    signIn: 'लॉगिन करें',
    fixErrors: 'ऊपर लाल रंग में लिखी चीज़ें ठीक करें।',
    phoneTaken: 'यह नंबर पहले से रजिस्टर है। लॉगिन करें।',
    tooMany: 'बहुत बार कोशिश हुई। थोड़ी देर बाद फिर कोशिश करें।',
    network: 'सर्वर से जुड़ नहीं पाए। इंटरनेट चेक करके फिर कोशिश करें।',
    errors: {
      salonName: 'सैलून का नाम लिखें (कम से कम 2 अक्षर)।',
      phone: 'सही 10 अंकों का मोबाइल नंबर लिखें, जैसे 98765 43210।',
      address: 'पूरा पता लिखें।',
      district: 'जिले का नाम 80 अक्षर से छोटा रखें।',
      state: 'राज्य का नाम 80 अक्षर से छोटा रखें।',
      ownerName: 'अपना नाम लिखें।',
      password: 'पासवर्ड 6 से 72 अक्षर का रखें।',
      confirm: 'दोनों पासवर्ड एक जैसे नहीं हैं।',
    } as Record<FieldKey, string>,
  },
  en: {
    pageTitle: 'Register your salon',
    intro: 'Takes 2 minutes. After this you get a QR code to put up in your shop.',
    step1: '1. Your salon',
    step2: '2. About you',
    salonName: 'Salon name',
    salonNameHint: 'Customers will see this name.',
    phone: 'Salon mobile number',
    phoneHint: 'You will sign in with this number. It is also printed under your QR.',
    fill: '📍 Fill automatically',
    fillHint: 'Tap this at the salon. Your phone will ask to share your location.',
    locating: 'Getting your location...',
    located: 'Location found',
    lookingUp: 'Finding your address...',
    denied: 'No location. That is fine, type the address yourself.',
    addressMissing: 'We could not find the full address. Please type it in.',
    address: 'Salon address',
    addressHint: 'For example: Main Road, near the bus stand',
    district: 'District',
    state: 'State',
    autoHint: 'Filled automatically',
    ownerName: 'Your name',
    password: 'Password',
    passwordHint: 'At least 6 characters. Remember it.',
    confirm: 'Confirm password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    show: 'Show',
    hide: 'Hide',
    laterNote: 'Opening hours (9 am to 9 pm for now) can be changed later in Settings.',
    submit: 'Register salon',
    submittingLocation: 'Getting your location...',
    submitting: 'Creating your salon...',
    haveAccount: 'Already registered?',
    signIn: 'Sign in',
    fixErrors: 'Please fix the items marked in red above.',
    phoneTaken: 'This number is already registered. Sign in instead.',
    tooMany: 'Too many tries. Please wait a while and try again.',
    network: 'We could not reach the server. Check your internet and try again.',
    errors: {
      salonName: 'Enter your salon name (at least 2 letters).',
      phone: 'Enter a valid 10-digit mobile number, e.g. 98765 43210.',
      address: 'Enter the full address.',
      district: 'Keep the district under 80 letters.',
      state: 'Keep the state under 80 letters.',
      ownerName: 'Enter your name.',
      password: 'Use 6 to 72 characters.',
      confirm: 'The two passwords do not match.',
    } as Record<FieldKey, string>,
  },
};

// null when the barber denies permission, the browser has no GPS, or it times out.
function getPosition(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

const round6 = (n: number) => Number(n.toFixed(6));

function findProblems(f: Form): FieldKey[] {
  const bad: FieldKey[] = [];
  if (f.salonName.trim().length < 2) bad.push('salonName');
  if (!normalizeIndianMobile(f.phone)) bad.push('phone');
  if (f.address.trim().length < 5) bad.push('address');
  if (f.district.trim().length > 80) bad.push('district');
  if (f.state.trim().length > 80) bad.push('state');
  if (!f.ownerName.trim()) bad.push('ownerName');
  if (f.password.length < MIN_PASSWORD || f.password.length > 72) bad.push('password');
  else if (f.confirm !== f.password) bad.push('confirm');
  return bad;
}

// Server field errors keep the server's wording; the format checks above already ran.
function fromServer(fieldErrors: Record<string, string[] | undefined> | undefined) {
  const msgs: Partial<Record<FieldKey, string>> = {};
  for (const [key, list] of Object.entries(fieldErrors ?? {})) {
    const msg = list?.[0];
    if (msg && (FIELD_ORDER as string[]).includes(key)) msgs[key as FieldKey] ??= msg;
  }
  return msgs;
}

type FormError =
  | { kind: 'fix' | 'tooMany' | 'network' }
  | { kind: 'server'; message: string };

export default function BarberRegister() {
  const t = useT(TEXT);
  const navigate = useNavigate();
  const [f, setF] = useState<Form>(EMPTY);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [loc, setLoc] = useState<'idle' | 'asking' | 'found' | 'denied'>('idle');
  const [lookingUp, setLookingUp] = useState(false);
  const [addressMissing, setAddressMissing] = useState(false);
  const [bad, setBad] = useState<Set<FieldKey>>(new Set());
  const [serverMsgs, setServerMsgs] = useState<Partial<Record<FieldKey, string>>>({});
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [phase, setPhase] = useState<'idle' | 'locating' | 'saving'>('idle');
  const [showPassword, setShowPassword] = useState(false);
  // Fields the owner typed in themselves: a lookup must never overwrite these.
  const edited = useRef(new Set<FieldKey>());

  const busy = phase !== 'idle';

  function clearProblems(keys: FieldKey[]) {
    setBad((prev) => {
      if (!keys.some((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
  }

  const set = (k: FieldKey) => (e: ChangeEvent<HTMLInputElement>) => {
    edited.current.add(k);
    const value = e.target.value;
    setF((p) => ({ ...p, [k]: value }));
    clearProblems(k === 'password' ? ['password', 'confirm'] : [k]);
    if (k === 'phone') setPhoneTaken(false);
  };

  // Fill address/district/state from the lookup, never over what the owner typed.
  function applyPlace(place: GeoPlace) {
    setF((p) => {
      const next = { ...p };
      for (const k of AUTO_FIELDS) {
        const v = place[k];
        if (v && !edited.current.has(k)) next[k] = v;
      }
      return next;
    });
    clearProblems([...AUTO_FIELDS]);
  }

  async function fillAutomatically() {
    setLoc('asking');
    setAddressMissing(false);
    const pos = await getPosition();
    if (!pos) {
      setLoc('denied');
      return;
    }
    setCoords(pos);
    setLoc('found');
    setLookingUp(true);
    try {
      const place = await reverseGeocode(pos.lat, pos.lng);
      applyPlace(place);
      if (!place.address) setAddressMissing(true);
    } catch {
      setAddressMissing(true);
    } finally {
      setLookingUp(false);
    }
  }

  function showProblems(keys: FieldKey[]) {
    setBad(new Set(keys));
    setFormError({ kind: 'fix' });
    const first = FIELD_ORDER.find((k) => keys.includes(k));
    if (first) setTimeout(() => document.getElementById(first)?.focus(), 0);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setServerMsgs({});
    setPhoneTaken(false);
    const problems = findProblems(f);
    if (problems.length) {
      showProblems(problems);
      return;
    }
    setFormError(null);

    let position = coords;
    let district = f.district.trim();
    let state = f.state.trim();
    try {
      // Not located yet and not refused before: ask now. Refusing still registers the salon.
      if (!position && loc !== 'denied') {
        setPhase('locating');
        setLoc('asking');
        position = await getPosition();
        if (position) {
          setCoords(position);
          setLoc('found');
          if (!district && !state) {
            try {
              const place = await reverseGeocode(position.lat, position.lng);
              district = place.district?.trim() ?? '';
              state = place.state?.trim() ?? '';
              applyPlace(place);
            } catch {
              /* district stays empty; the salon still registers */
            }
          }
        } else {
          setLoc('denied');
        }
      }

      setPhase('saving');
      await registerSalon({
        salonName: f.salonName.trim(),
        phone: f.phone.trim(),
        address: f.address.trim(),
        ...(position && { latitude: round6(position.lat), longitude: round6(position.lng) }),
        ...(district && { district }),
        ...(state && { state }),
        ownerName: f.ownerName.trim(),
        password: f.password,
        ...DEFAULT_HOURS,
      });
      navigate('/barber/settings/services', { replace: true, state: { welcome: true } });
    } catch (err) {
      if (err instanceof ApiError) {
        const msgs = fromServer(err.fieldErrors);
        if (err.status === 409) {
          setPhoneTaken(true);
          showProblems(['phone']);
        } else if (Object.keys(msgs).length) {
          setServerMsgs(msgs);
          showProblems(Object.keys(msgs) as FieldKey[]);
        } else if (err.status === 429) {
          setFormError({ kind: 'tooMany' });
        } else {
          setFormError({ kind: 'server', message: err.message });
        }
      } else {
        setFormError({ kind: 'network' });
      }
    } finally {
      setPhase('idle');
    }
  }

  const errorText = (k: FieldKey) =>
    k === 'phone' && phoneTaken ? t.phoneTaken : serverMsgs[k] ?? t.errors[k];

  const describe = (k: FieldKey, hint: boolean) =>
    [hint && `${k}-hint`, bad.has(k) && `${k}-error`].filter(Boolean).join(' ') || undefined;

  const errorLine = (k: FieldKey) =>
    bad.has(k) ? <p id={`${k}-error`} className="mt-1 text-sm text-red-700">{errorText(k)}</p> : null;

  const textInput = (
    k: Exclude<FieldKey, 'password' | 'confirm'>,
    label: string,
    hint?: string,
    attrs: InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div>
      <label htmlFor={k} className="mb-1 block text-base font-medium">{label}</label>
      <input
        id={k}
        className="field"
        value={f[k]}
        onChange={set(k)}
        aria-invalid={bad.has(k) || undefined}
        aria-describedby={describe(k, !!hint)}
        {...attrs}
      />
      {hint && <p id={`${k}-hint`} className="mt-1 text-sm text-gray-600">{hint}</p>}
      {errorLine(k)}
    </div>
  );

  const passwordInput = (k: 'password' | 'confirm', label: string, hint?: string) => (
    <div>
      <label htmlFor={k} className="mb-1 block text-base font-medium">{label}</label>
      <div className="relative">
        <input
          id={k}
          className="field pr-24"
          type={showPassword ? 'text' : 'password'}
          value={f[k]}
          onChange={set(k)}
          autoComplete="new-password"
          required
          aria-invalid={bad.has(k) || undefined}
          aria-describedby={describe(k, !!hint)}
        />
        {k === 'password' && (
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? t.hidePassword : t.showPassword}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 min-w-11 px-3 text-sm font-medium text-gray-900 underline"
          >
            {showPassword ? t.hide : t.show}
          </button>
        )}
      </div>
      {hint && <p id={`${k}-hint`} className="mt-1 text-sm text-gray-600">{hint}</p>}
      {errorLine(k)}
    </div>
  );

  return (
    <PageShell title={t.pageTitle}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <BrandMark />
        <LangToggle />
      </div>
      <h1 className="mb-1 text-2xl font-semibold">{t.pageTitle}</h1>
      <p className="mb-5 text-base text-gray-700">{t.intro}</p>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <section className="card space-y-4 p-5" aria-labelledby="reg-step1">
          <h2 id="reg-step1" className="text-lg font-semibold">{t.step1}</h2>
          {textInput('salonName', t.salonName, t.salonNameHint, { autoComplete: 'organization', required: true })}
          {textInput('phone', t.phone, t.phoneHint, {
            type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '98765 43210', required: true,
          })}

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void fillAutomatically()}
              disabled={loc === 'asking' || lookingUp || busy}
              className="btn-secondary"
              aria-describedby="fill-hint"
            >
              {loc === 'asking' ? t.locating : t.fill}
            </button>
            <p id="fill-hint" className="text-sm text-gray-600">{t.fillHint}</p>
            <p role="status" className="text-sm">
              {loc === 'found' && !lookingUp && (
                <span className="font-medium text-green-800">
                  <span aria-hidden="true">✓ </span>
                  {t.located}
                </span>
              )}
              {lookingUp && <span className="text-gray-600">{t.lookingUp}</span>}
              {loc === 'denied' && <span className="text-amber-900">{t.denied}</span>}
              {loc === 'found' && !lookingUp && addressMissing && !f.address.trim() && (
                <span className="block text-amber-900">{t.addressMissing}</span>
              )}
            </p>
          </div>

          {textInput('address', t.address, t.addressHint, { autoComplete: 'street-address', required: true })}
          <div className="grid grid-cols-2 gap-3">
            {textInput('district', t.district, t.autoHint, { autoComplete: 'off' })}
            {textInput('state', t.state, t.autoHint, { autoComplete: 'off' })}
          </div>
        </section>

        <section className="card space-y-4 p-5" aria-labelledby="reg-step2">
          <h2 id="reg-step2" className="text-lg font-semibold">{t.step2}</h2>
          {textInput('ownerName', t.ownerName, undefined, { autoComplete: 'name', required: true })}
          {passwordInput('password', t.password, t.passwordHint)}
          {passwordInput('confirm', t.confirm)}
        </section>

        <p className="text-sm text-gray-600">{t.laterNote}</p>

        {formError && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {formError.kind === 'server' ? formError.message : t[formError.kind === 'fix' ? 'fixErrors' : formError.kind]}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn-primary">
          {phase === 'locating' ? t.submittingLocation : phase === 'saving' ? t.submitting : t.submit}
        </button>
      </form>

      <p className="mt-5 text-center text-base text-gray-600">
        {t.haveAccount}{' '}
        <Link to="/barber/login" className="font-medium text-gray-900 underline">{t.signIn}</Link>
      </p>
    </PageShell>
  );
}