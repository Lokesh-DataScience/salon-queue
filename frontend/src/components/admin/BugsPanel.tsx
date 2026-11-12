// frontend/src/components/admin/BugsPanel.tsx
// Tech → Bugs: reports from barbers. Set a status and a reply; the barber sees both on their report page.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBugs, updateBug, type BugReport, type BugStatus } from '../../api/admin';
import { ago } from './TechPanel';

const KIND: Record<BugReport['kind'], string> = { bug: 'Broken', idea: 'Idea', question: 'Question' };
const STATUS: Record<BugStatus, string> = { new: 'New', investigating: 'Looking into it', fixed: 'Fixed', wont_fix: "Won't fix" };

function BugCard({ b }: { b: BugReport }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<BugStatus>(b.status);
  const [note, setNote] = useState(b.techNote);
  const save = useMutation({
    mutationFn: () => updateBug(b.id, { status, techNote: note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['techBugs'] }),
  });
  const changed = status !== b.status || note !== b.techNote;
  const sid = `bug-status-${b.id}`;
  const nid = `bug-note-${b.id}`;

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-800">{KIND[b.kind]}</span>
        <span className="text-sm font-semibold">{b.salonName ?? 'Deleted salon'}</span>
        <span className="text-xs text-gray-600">{ago(b.createdAt)}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap">{b.message}</p>
      <p className="mt-1 text-xs text-gray-600">
        {b.reporter ? `${b.reporter.name}${b.reporter.contact ? ` · ${b.reporter.contact}` : ''}` : 'Deleted account'}
        {b.page ? ` · from ${b.page}` : ''}
      </p>
      {b.device && <p className="break-all font-mono text-xs text-gray-500">{b.device}</p>}

      <form className="mt-2 grid gap-2" aria-label={`Update report from ${b.salonName ?? 'a salon'}`}
        onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={sid} className="mb-1 block text-xs font-medium">Status</label>
            <select id={sid} className="field" value={status} onChange={(e) => setStatus(e.target.value as BugStatus)}>
              {(Object.keys(STATUS) as BugStatus[]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
            </select>
          </div>
        </div>
        <label htmlFor={nid} className="text-xs font-medium">Reply to the barber (they see this)</label>
        <textarea id={nid} className="field min-h-16" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        {save.isError && (
          <p role="alert" className="text-sm text-red-700">{save.error instanceof Error ? save.error.message : 'Could not save.'}</p>
        )}
        <button type="submit" className="btn-primary min-h-11" disabled={!changed || save.isPending}>
          {save.isPending ? 'Saving...' : 'Save'}
        </button>
      </form>
    </li>
  );
}

export default function BugsPanel() {
  const [show, setShow] = useState<'open' | 'all'>('open');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['techBugs', show],
    queryFn: () => fetchBugs(show),
    refetchOnWindowFocus: true,
    retry: false,
  });

  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Show" className="grid grid-cols-2 gap-2">
        {(['open', 'all'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}
            className={`min-h-11 rounded-xl px-3 text-sm ${
              show === s ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
            }`}>
            {s === 'open' ? 'Open' : 'All'}
          </button>
        ))}
      </div>
      {isLoading && <p role="status" className="text-gray-600">Loading reports...</p>}
      {isError && !data && (
        <div className="card text-center">
          <p role="alert" className="mb-3 text-red-700">Couldn't load reports.</p>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      )}
      {data && data.length === 0 && <p className="text-gray-600">{show === 'open' ? 'No open reports.' : 'No reports yet.'}</p>}
      {data && data.length > 0 && (
        <ul aria-label="Bug reports" className="card divide-y divide-gray-200 py-0">
          {data.map((b) => <BugCard key={`${b.id}-${b.updatedAt}`} b={b} />)}
        </ul>
      )}
    </div>
  );
}
