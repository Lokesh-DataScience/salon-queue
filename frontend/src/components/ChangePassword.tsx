// frontend/src/components/ChangePassword.tsx
// Staff have no Settings page, so they change their own password here, on the Dashboard.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changeOwnPassword } from '../api/barber';
import { ApiError } from '../api/client';

function reason(e: unknown) {
  if (e instanceof ApiError && e.fieldErrors) {
    const first = Object.values(e.fieldErrors).flat().find(Boolean);
    if (first) return first;
  }
  return e instanceof Error ? e.message : 'Could not change the password.';
}

export default function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const change = useMutation({
    mutationFn: () => changeOwnPassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setAgain('');
      setMsg({ ok: true, text: 'Your password was changed.' });
    },
    onError: (e) => setMsg({ ok: false, text: reason(e) }),
  });

  const mismatch = again.length > 0 && again !== next;
  const ready = current.length > 0 && next.length >= 8 && again === next;

  return (
    <details className="mt-6 rounded-xl border-2 border-gray-300 bg-white px-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-gray-700">My account</summary>
      <form
        className="grid gap-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          change.mutate();
        }}
      >
        <h2 className="text-base font-semibold">Change my password</h2>
        <div>
          <label htmlFor="pw-current" className="mb-1 block text-sm font-medium">Current password</label>
          <input id="pw-current" type="password" className="field" autoComplete="current-password" value={current}
            maxLength={200} onChange={(e) => { setCurrent(e.target.value); setMsg(null); }} />
        </div>
        <div>
          <label htmlFor="pw-new" className="mb-1 block text-sm font-medium">New password</label>
          <input id="pw-new" type="password" className="field" autoComplete="new-password" value={next}
            maxLength={72} onChange={(e) => { setNext(e.target.value); setMsg(null); }} />
          <p className="mt-1 text-sm text-gray-600">At least 8 characters.</p>
        </div>
        <div>
          <label htmlFor="pw-again" className="mb-1 block text-sm font-medium">New password again</label>
          <input id="pw-again" type="password" className="field" autoComplete="new-password" value={again}
            maxLength={72} onChange={(e) => { setAgain(e.target.value); setMsg(null); }} />
          {mismatch && <p role="alert" className="mt-1 text-sm text-red-700">The two new passwords are different.</p>}
        </div>
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
            {msg.text}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={!ready || change.isPending}>
          {change.isPending ? 'Saving...' : 'Change password'}
        </button>
      </form>
    </details>
  );
}
