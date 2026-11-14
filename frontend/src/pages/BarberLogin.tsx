// frontend/src/pages/BarberLogin.tsx
// Staff sign in with their mobile number. Owners who registered before step18 with only an
// email use the "sign in with email" link. Hindi by default, EN/हिं switch (svq.lang.v1).
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { loginBarber } from '../api/barber';
import { ApiError } from '../api/client';
import PageShell from '../components/PageShell';
import BrandMark from '../components/BrandMark';
import LangToggle from '../components/LangToggle';
import { useT } from '../lib/i18n';
import { normalizeIndianMobile } from '../lib/phone';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TEXT = {
  hi: {
    title: 'लॉगिन करें',
    intro: 'अपने सैलून की लाइन चलाने के लिए लॉगिन करें।',
    expired: 'जारी रखने के लिए फिर से लॉगिन करें।',
    phone: 'मोबाइल नंबर',
    email: 'ईमेल',
    password: 'पासवर्ड',
    showPassword: 'पासवर्ड दिखाएं',
    hidePassword: 'पासवर्ड छुपाएं',
    show: 'दिखाएं',
    hide: 'छुपाएं',
    submit: 'लॉगिन करें',
    submitting: 'लॉगिन हो रहा है...',
    useEmail: 'पुराना अकाउंट? ईमेल से लॉगिन करें',
    usePhone: 'मोबाइल नंबर से लॉगिन करें',
    newSalon: 'नया सैलून?',
    register: 'सैलून रजिस्टर करें',
    badPhone: 'सही 10 अंकों का मोबाइल नंबर लिखें।',
    badEmail: 'सही ईमेल लिखें।',
    noPassword: 'पासवर्ड लिखें।',
    badLoginPhone: 'मोबाइल नंबर या पासवर्ड गलत है।',
    badLoginEmail: 'ईमेल या पासवर्ड गलत है।',
    tooMany: 'बहुत बार कोशिश हुई। थोड़ी देर बाद फिर कोशिश करें।',
    network: 'सर्वर से जुड़ नहीं पाए। इंटरनेट चेक करके फिर कोशिश करें।',
  },
  en: {
    title: 'Sign in',
    intro: "Sign in to run your salon's queue.",
    expired: 'Please sign in to continue.',
    phone: 'Mobile number',
    email: 'Email',
    password: 'Password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    show: 'Show',
    hide: 'Hide',
    submit: 'Sign in',
    submitting: 'Signing in...',
    useEmail: 'Older account? Sign in with email',
    usePhone: 'Sign in with mobile number',
    newSalon: 'New salon?',
    register: 'Register your salon',
    badPhone: 'Enter a valid 10-digit mobile number.',
    badEmail: 'Enter a valid email.',
    noPassword: 'Enter your password.',
    badLoginPhone: 'Wrong mobile number or password.',
    badLoginEmail: 'Wrong email or password.',
    tooMany: 'Too many tries. Please wait a while and try again.',
    network: 'We could not reach the server. Check your internet and try again.',
  },
};

type ErrorKey = 'badPhone' | 'badEmail' | 'noPassword' | 'badLogin' | 'tooMany' | 'network';
type LoginError = { key: ErrorKey } | { message: string };

export default function BarberLogin() {
  const t = useT(TEXT);
  const navigate = useNavigate();
  const location = useLocation();
  const expired = (location.state as { expired?: boolean } | null)?.expired;
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);

  function switchMode() {
    setMode((m) => (m === 'phone' ? 'email' : 'phone'));
    setIdentifier('');
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const id = mode === 'phone' ? normalizeIndianMobile(identifier) : identifier.trim().toLowerCase();
    if (mode === 'phone' && !id) return setError({ key: 'badPhone' });
    if (mode === 'email' && !EMAIL_RE.test(id ?? '')) return setError({ key: 'badEmail' });
    if (!password) return setError({ key: 'noPassword' });

    setSubmitting(true);
    setError(null);
    try {
      await loginBarber(id as string, password);
      navigate('/barber/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError({ key: 'badLogin' });
        else if (err.status === 429) setError({ key: 'tooMany' });
        else setError({ message: err.message }); // switched-off account, suspended salon
      } else {
        setError({ key: 'network' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const errorText = !error
    ? null
    : 'message' in error
      ? error.message
      : error.key === 'badLogin'
        ? mode === 'phone' ? t.badLoginPhone : t.badLoginEmail
        : t[error.key];

  return (
    <PageShell title={t.title}>
      <div className="flex min-h-[80dvh] flex-col justify-center">
        <div className="mb-3 flex items-start justify-between gap-3">
          <BrandMark />
          <LangToggle />
        </div>
        <div className="card p-6">
          <h1 className="mb-1 text-2xl font-semibold">{t.title}</h1>
          <p className="mb-5 text-base text-gray-600">{t.intro}</p>
          {expired && (
            <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {t.expired}
            </p>
          )}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="identifier" className="mb-1 block text-base font-medium">
                {mode === 'phone' ? t.phone : t.email}
              </label>
              {mode === 'phone' ? (
                <input
                  key="phone"
                  id="identifier"
                  type="tel"
                  inputMode="tel"
                  autoComplete="username"
                  placeholder="98765 43210"
                  className="field"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  aria-describedby={errorText ? 'login-error' : undefined}
                  required
                />
              ) : (
                <input
                  key="email"
                  id="identifier"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="field"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  aria-describedby={errorText ? 'login-error' : undefined}
                  required
                />
              )}
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-base font-medium">{t.password}</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="field pr-24"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={errorText ? 'login-error' : undefined}
                  aria-invalid={errorText ? true : undefined}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? t.hidePassword : t.showPassword}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 min-w-11 px-3 text-sm font-medium text-gray-900 underline"
                >
                  {showPassword ? t.hide : t.show}
                </button>
              </div>
            </div>
            {errorText && (
              <p id="login-error" role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                {errorText}
              </p>
            )}
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? t.submitting : t.submit}
            </button>
          </form>
          <button
            type="button"
            onClick={switchMode}
            className="mt-4 min-h-11 w-full text-center text-sm font-medium text-gray-700 underline"
          >
            {mode === 'phone' ? t.useEmail : t.usePhone}
          </button>
        </div>
        <p className="mt-5 text-center text-base text-gray-600">
          {t.newSalon}{' '}
          <Link to="/barber/register" className="font-medium text-gray-900 underline">{t.register}</Link>
        </p>
      </div>
    </PageShell>
  );
}