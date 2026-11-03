// frontend/components/ChangePasswordForm.tsx
import { useState } from 'react';
import { changePassword } from '../api/barber';
import { ApiError } from '../api/client';

export default function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!current) return setMsg({ ok: false, text: 'Enter your current password.' });
    if (next.length < 10) return setMsg({ ok: false, text: 'Use at least 10 characters for the new password.' });
    if (next.length > 72) return setMsg({ ok: false, text: 'The new password can be at most 72 characters.' });
    if (next === current) return setMsg({ ok: false, text: 'Choose a password different from your current one.' });
    if (next !== confirm) return setMsg({ ok: false, text: 'The two new passwords do not match.' });

    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMsg({
        ok: true,
        text: 'Password changed. Any other phone or browser that was signed in will be signed out.',
      });
    } catch (err) {
      const detail = err instanceof ApiError ? Object.values(err.fieldErrors ?? {})[0]?.[0] : undefined;
      setMsg({ ok: false, text: detail ?? (err instanceof Error ? err.message : 'Could not change the password.') });
    } finally {
      setBusy(false);
    }
  }

  const touch = () => setMsg(null);

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <div>
        <label htmlFor="pw-current" className="mb-1 block text-sm font-medium">Current password</label>
        <input id="pw-current" type="password" autoComplete="current-password" className="field"
          value={current} onChange={(e) => { setCurrent(e.target.value); touch(); }} />
      </div>
      <div>
        <label htmlFor="pw-new" className="mb-1 block text-sm font-medium">New password (at least 10 characters)</label>
        <input id="pw-new" type="password" autoComplete="new-password" className="field"
          value={next} onChange={(e) => { setNext(e.target.value); touch(); }} />
      </div>
      <div>
        <label htmlFor="pw-confirm" className="mb-1 block text-sm font-medium">Confirm new password</label>
        <input id="pw-confirm" type="password" autoComplete="new-password" className="field"
          value={confirm} onChange={(e) => { setConfirm(e.target.value); touch(); }} />
      </div>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>
        {busy ? 'Changing...' : 'Change password'}
      </button>
    </form>
  );
}