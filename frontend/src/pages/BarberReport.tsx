// frontend/src/pages/BarberReport.tsx
// Settings → Report a problem. The barber writes what happened; the team sees it in the Tech tab
// and answers with a status and a note shown here.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import { fetchMyBugReports, sendBugReport, type BugKind, type BugStatus } from '../api/bugReports';

const KINDS: { id: BugKind; label: string }[] = [
  { id: 'bug', label: 'Something is broken' },
  { id: 'idea', label: 'An idea' },
  { id: 'question', label: 'A question' },
];

export const STATUS_TEXT: Record<BugStatus, string> = {
  new: 'Received',
  investigating: 'Being looked at',
  fixed: 'Fixed',
  wont_fix: 'Closed',
};

// The page they came from (no query string: ticket links carry private tokens) and the phone/browser.
function context() {
  const from = (document.referrer && new URL(document.referrer, window.location.origin).pathname) || window.location.pathname;
  return { page: from.slice(0, 200), device: navigator.userAgent.slice(0, 300) };
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export default function BarberReport() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<BugKind>('bug');
  const [message, setMessage] = useState('');
  const mine = useQuery({ queryKey: ['myBugReports'], queryFn: fetchMyBugReports, retry: false });
  const send = useMutation({
    mutationFn: () => sendBugReport({ kind, message: message.trim(), ...context() }),
    onSuccess: async () => {
      setMessage('');
      await qc.invalidateQueries({ queryKey: ['myBugReports'] });
    },
  });

  return (
    <PageShell title="Report a problem">
      <Link to="/barber/settings" className="mb-4 inline-block text-sm font-semibold text-gray-700 underline">‹ Settings</Link>
      <h1 className="mb-4 text-2xl font-bold">Report a problem</h1>

      <form
        className="card grid gap-3"
        aria-label="Report a problem"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <fieldset>
          <legend className="mb-1 text-sm font-medium">What is it?</legend>
          <div className="grid gap-2">
            {KINDS.map((k) => (
              <label key={k.id} className={`flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 ${kind === k.id ? 'border-ink bg-brand font-bold' : 'border-gray-300'}`}>
                <input type="radio" name="bug-kind" className="h-5 w-5" checked={kind === k.id} onChange={() => setKind(k.id)} />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="bug-message" className="mb-1 block text-sm font-medium">Tell us what happened</label>
          <textarea
            id="bug-message"
            className="field min-h-32"
            required
            minLength={5}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-describedby="bug-hint"
          />
          <p id="bug-hint" className="mt-1 text-xs text-gray-600">
            What were you doing, and what went wrong? Please don't write customers' names or phone numbers.
          </p>
        </div>
        {send.isError && (
          <p role="alert" className="text-sm text-red-700">
            {send.error instanceof Error ? send.error.message : "Couldn't send. Please try again."}
          </p>
        )}
        {send.isSuccess && <p role="status" className="text-sm font-semibold text-green-800">Thank you. We've got it.</p>}
        <button type="submit" className="btn-primary" disabled={send.isPending || message.trim().length < 5}>
          {send.isPending ? 'Sending...' : 'Send'}
        </button>
      </form>

      {mine.data && mine.data.length > 0 && (
        <section aria-label="Your reports" className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Your reports</h2>
          <ul className="card divide-y divide-gray-200 py-0">
            {mine.data.map((r) => (
              <li key={r.id} className="py-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{STATUS_TEXT[r.status]}</span>
                  <span className="text-gray-600">· {fmtDate(r.createdAt)}</span>
                </p>
                <p className="whitespace-pre-wrap text-sm">{r.message}</p>
                {r.techNote && <p className="mt-1 rounded-lg bg-brand-soft p-2 text-sm">Reply: {r.techNote}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
