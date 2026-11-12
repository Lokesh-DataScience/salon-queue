// frontend/src/components/admin/ToolsPanel.tsx
// Tech → Tools & flags. Testing tools act only on internal salons (the server refuses real ones);
// flags switch features on/off for every barber without a redeploy.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFlags,
  fetchTestSalons,
  runTestAction,
  updateFlag,
  type AdminFlag,
  type TestAction,
} from '../../api/admin';
import { ago } from './TechPanel';

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function TestingTools() {
  const { data: salons, isLoading, isError } = useQuery({ queryKey: ['testSalons'], queryFn: fetchTestSalons, retry: false });
  const [salonId, setSalonId] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState<{ text: string; link?: string } | null>(null);
  const chosen = salonId || salons?.[0]?.id || '';

  const run = useMutation({
    mutationFn: ({ action, body }: { action: TestAction; body?: { token?: number } }) => runTestAction(chosen, action, body),
    onSuccess: (r, { action }) => {
      if (action === 'scan') setResult({ text: `Added test customer #${r.token}.`, link: r.ticketUrl });
      else if (action === 'walk-in') setResult({ text: `Added walk-in #${r.token}.` });
      else if (action === 'finish') setResult({ text: `Finished #${(r.tokens ?? []).join(', #')}. The next customer starts now.` });
      else if (action === 'push') setResult({ text: `Sent "It's your turn" to #${r.token}.` });
      else setResult({ text: `Cleared today's queue (${r.cancelled ?? 0} cancelled).` });
    },
    onError: () => setResult(null),
  });

  const tokenNum = Number(token);
  const tokenOk = token.trim() !== '' && Number.isInteger(tokenNum) && tokenNum > 0;
  const go = (action: TestAction, body?: { token?: number }) => {
    setResult(null);
    run.mutate({ action, body });
  };

  if (isLoading) return <p role="status" className="text-gray-600">Loading...</p>;
  if (isError) return <p role="alert" className="text-red-700">Could not load test salons.</p>;
  if (!salons || salons.length === 0) {
    return (
      <p className="text-gray-700">
        No internal salons yet. Mark a test salon as internal in Founder → Salons, then come back.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-gray-700">Works only on internal salons. Every action is in the audit log.</p>
      <div>
        <label htmlFor="test-salon" className="mb-1 block text-sm font-medium">Test salon</label>
        <select id="test-salon" className="field" value={chosen} onChange={(e) => { setSalonId(e.target.value); setResult(null); }}>
          {salons.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.hours}){s.isSuspended ? ' · suspended' : ''}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-primary min-h-11" disabled={run.isPending} onClick={() => go('scan')}>
          Add QR customer
        </button>
        <button type="button" className="btn-secondary min-h-11" disabled={run.isPending} onClick={() => go('walk-in')}>
          Add walk-in
        </button>
      </div>

      <div>
        <label htmlFor="test-token" className="mb-1 block text-sm font-medium">Token number (for push, optional for finish)</label>
        <input id="test-token" className="field" inputMode="numeric" value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary min-h-11" disabled={run.isPending}
          onClick={() => go('finish', tokenOk ? { token: tokenNum } : {})}>
          Finish service now
        </button>
        <button type="button" className="btn-secondary min-h-11" disabled={run.isPending || !tokenOk}
          onClick={() => go('push', { token: tokenNum })}>
          Send test push
        </button>
      </div>
      <button type="button" className="btn-secondary min-h-11" disabled={run.isPending}
        onClick={() => { if (window.confirm("Cancel everyone still in today's queue for this test salon?")) go('clear'); }}>
        Clear today's queue
      </button>

      <div aria-live="polite">
        {run.isPending && <p role="status" className="text-gray-600">Working...</p>}
        {result && (
          <p className="rounded-xl bg-brand-soft p-3">
            {result.text}{' '}
            {result.link && <a className="font-semibold underline" href={result.link} target="_blank" rel="noreferrer">Open their ticket</a>}
          </p>
        )}
        {run.isError && <p role="alert" className="text-red-700">{errText(run.error, 'That did not work. Please try again.')}</p>}
      </div>
    </div>
  );
}

function FlagRow({ f }: { f: AdminFlag }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(f.value);
  const save = useMutation({
    mutationFn: (patch: { enabled?: boolean; value?: string }) => updateFlag(f.key, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['techFlags'] }),
  });
  const vid = `flag-value-${f.key}`;

  return (
    <li className="grid gap-2 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-bold">{f.key}</p>
          <p className="text-xs text-gray-600">Changed {ago(f.updatedAt)}</p>
        </div>
        <button type="button" aria-pressed={f.enabled} aria-label={`${f.key}: ${f.enabled ? 'on' : 'off'}`}
          disabled={save.isPending} onClick={() => save.mutate({ enabled: !f.enabled })}
          className={`min-h-11 min-w-20 rounded-xl px-3 text-sm ${
            f.enabled ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
          }`}>
          {f.enabled ? 'On' : 'Off'}
        </button>
      </div>
      {f.description && <p className="text-sm text-gray-700">{f.description}</p>}
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ value }); }}>
        <label htmlFor={vid} className="text-xs font-medium">Text (optional)</label>
        <div className="flex gap-2">
          <input id={vid} className="field flex-1" maxLength={200} value={value} onChange={(e) => setValue(e.target.value)} />
          <button type="submit" className="btn-secondary min-h-11" disabled={value === f.value || save.isPending}>Save</button>
        </div>
      </form>
      {save.isError && <p role="alert" className="text-sm text-red-700">{errText(save.error, 'Could not save.')}</p>}
    </li>
  );
}

function Flags() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['techFlags'], queryFn: fetchFlags, retry: false });
  if (isLoading) return <p role="status" className="text-gray-600">Loading...</p>;
  if (isError) return <p role="alert" className="text-red-700">Could not load flags.</p>;
  return (
    <>
      <p className="text-sm text-gray-700">Changes reach barbers within about a minute. New flags are added with SQL.</p>
      <ul className="divide-y divide-gray-200">
        {(data ?? []).map((f) => <FlagRow key={f.key} f={f} />)}
      </ul>
    </>
  );
}

export default function ToolsPanel() {
  return (
    <div className="grid gap-4">
      <section aria-labelledby="tools-h" className="card">
        <h2 id="tools-h" className="mb-3 text-lg font-bold">Testing tools</h2>
        <TestingTools />
      </section>
      <section aria-labelledby="flags-h" className="card">
        <h2 id="flags-h" className="mb-3 text-lg font-bold">Feature flags</h2>
        <Flags />
      </section>
    </div>
  );
}
