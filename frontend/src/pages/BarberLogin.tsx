import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { loginBarber } from '../api/barber';
import PageShell from '../components/PageShell';

export default function BarberLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const expired = (location.state as { expired?: boolean } | null)?.expired;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await loginBarber(email, password);
      navigate('/barber/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell title="Salon staff sign in">
      <h1 className="mb-1 text-xl font-semibold">Salon staff sign in</h1>
      <p className="mb-4 text-sm text-gray-600">Sign in to manage your salon's queue.</p>
      {expired && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Please sign in to continue.
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoCapitalize="none" 
            autoCorrect="off" 
            spellCheck={false}
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={error ? 'login-error' : undefined}
            required
          />
        </div>
        {error && (
          <p id="login-error" role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        New salon? <Link to="/barber/register" className="underline">Register your salon</Link>
      </p>
    </PageShell>
  );
}