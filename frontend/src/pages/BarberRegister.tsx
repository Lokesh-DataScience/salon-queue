import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerSalon } from '../api/barber';
import { ApiError } from '../api/client';
import PageShell from '../components/PageShell';

type FieldErrors = Record<string, string[] | undefined>;

export default function BarberRegister() {
  const navigate = useNavigate();
  const [f, setF] = useState({
    salonName: '', phone: '', address: '', latitude: '', longitude: '',
    ownerName: '', email: '', password: '',
    openingTime: '09:00', closingTime: '21:00', averageServiceMinutes: '15',
  });
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  function useMyLocation() {
    if (!navigator.geolocation) return setError('This browser cannot share your location. Enter it below.');
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setF((p) => ({
          ...p,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError('Location unavailable. Please type the latitude and longitude of your salon.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await registerSalon({
        salonName: f.salonName,
        phone: f.phone,
        address: f.address,
        latitude: Number(f.latitude),
        longitude: Number(f.longitude),
        ownerName: f.ownerName,
        email: f.email,
        password: f.password,
        openingTime: f.openingTime,
        closingTime: f.closingTime,
        averageServiceMinutes: Number(f.averageServiceMinutes),
      });
      navigate('/barber/qr', { replace: true, state: { welcome: true } });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors ?? {});
      } else {
        setError('We could not reach the server. Please check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (k: string) =>
    fieldErrors[k]?.[0] ? (
      <p id={`${k}-error`} className="mt-1 text-sm text-red-700">{fieldErrors[k]![0]}</p>
    ) : null;

  const input = (
    k: keyof typeof f, label: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div>
      <label htmlFor={k} className="mb-1 block text-sm font-medium">{label}</label>
      <input
        id={k} className="field" value={f[k]} onChange={set(k)} required
        aria-invalid={fieldErrors[k] ? true : undefined}
        aria-describedby={fieldErrors[k] ? `${k}-error` : undefined}
        {...extra}
      />
      {fieldError(k)}
    </div>
  );

  return (
    <PageShell title="Register your salon">
      <h1 className="mb-1 text-xl font-semibold">Register your salon</h1>
      <p className="mb-4 text-sm text-gray-600">
        Set up your queue in a minute. You'll get a QR code to print and stick up. Customers never need an account.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {input('salonName', 'Salon name', { autoComplete: 'organization' })}
        {input('phone', 'Salon phone number', { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
        {input('address', 'Address', { autoComplete: 'street-address' })}

        <fieldset className="space-y-3 rounded-lg border border-gray-300 p-3">
          <legend className="px-1 text-sm font-medium">Salon location</legend>
          <button type="button" onClick={useMyLocation} disabled={locating} className="btn-secondary">
            {locating ? 'Finding your location...' : 'Use my current location'}
          </button>
          <p className="text-xs text-gray-600">Best done while you are at the salon.</p>
          {input('latitude', 'Latitude', { inputMode: 'decimal' })}
          {input('longitude', 'Longitude', { inputMode: 'decimal' })}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          {input('openingTime', 'Opens', { type: 'time' })}
          {input('closingTime', 'Closes', { type: 'time' })}
        </div>
        {input('averageServiceMinutes', 'Average minutes per customer', { type: 'number', inputMode: 'numeric', min: 1, max: 240 })}

        <hr className="border-gray-200" />
        {input('ownerName', 'Your name', { autoComplete: 'name' })}
        {input('email', 'Email (you will sign in with this)', {
          type: 'email', autoComplete: 'username', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false,
        })}
        {input('password', 'Password (at least 10 characters)', { type: 'password', autoComplete: 'new-password', minLength: 10 })}

        {error && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>
        )}
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Creating your salon...' : 'Register salon'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        Already registered?{' '}
        <Link to="/barber/login" className="underline">Sign in</Link>
      </p>
    </PageShell>
  );
}