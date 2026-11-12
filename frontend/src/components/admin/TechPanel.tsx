// frontend/src/components/admin/TechPanel.tsx
// Tech tab: is everything running? Background jobs, database, live connections, server, deployed version.
import { useQuery } from '@tanstack/react-query';
import { fetchTechHealth, type CheckStatus, type TechJob } from '../../api/admin';

const STATUS: Record<CheckStatus, { text: string; cls: string }> = {
  ok: { text: 'OK', cls: 'border-green-600 bg-green-50 text-green-900' },
  late: { text: 'Late', cls: 'border-amber-400 bg-amber-50 text-amber-900' },
  failing: { text: 'Failing', cls: 'border-red-400 bg-red-50 text-red-900' },
  unknown: { text: 'No report yet', cls: 'border-gray-300 bg-gray-100 text-gray-800' },
};

// Words plus colour, never colour alone.
function StatusBadge({ status }: { status: CheckStatus }) {
  const s = STATUS[status];
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${s.cls}`}>{s.text}</span>;
}

export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} sec ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function uptime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function JobRow({ j }: { j: TechJob }) {
  const detail = Object.entries(j.detail ?? {});
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold">{j.label}</h4>
        <StatusBadge status={j.status} />
      </div>
      <p className="text-sm text-gray-700">
        Runs {j.schedule}. Last OK: {ago(j.lastSuccessAt)}.
        {j.lastFailureAt && <> Last failure: {ago(j.lastFailureAt)} ({j.lastFailureCode ?? 'unknown'}).</>}
      </p>
      {detail.length > 0 && (
        <p className="text-xs text-gray-600">{detail.map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
      )}
      {j.note && j.status === 'late' && <p className="text-xs text-gray-600">{j.note}</p>}
    </li>
  );
}

export default function TechPanel() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['techHealth'],
    queryFn: fetchTechHealth,
    staleTime: 0,
    refetchInterval: 30_000, // only while this tab is visible
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (isLoading) return <p role="status" className="text-gray-600">Checking the system...</p>;
  if (!data) {
    return (
      <div className="card text-center">
        <p role="alert" className="mb-4 text-red-700">Couldn't reach the server. It may be asleep or down.</p>
        <button type="button" className="btn-primary" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }

  const worst: CheckStatus = [data.database.status, ...data.jobs.filter((j) => j.name !== 'pinger').map((j) => j.status)]
    .reduce<CheckStatus>((w, s) => (s === 'failing' || w === 'failing' ? 'failing' : s === 'late' || w === 'late' ? 'late' : w), 'ok');

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-600">Checked {ago(data.checkedAt)}. Updates every 30 seconds.</p>
        <button type="button" onClick={() => refetch()} disabled={isFetching} aria-busy={isFetching}
          className="btn-secondary min-h-11 px-4 text-sm">
          {isFetching ? 'Checking...' : 'Check now'}
        </button>
      </div>
      {isError && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-center text-sm text-amber-900">
          Couldn't refresh. Showing the last check.
        </p>
      )}

      <section aria-label="Overall" className="card flex items-center justify-between">
        <span className="text-base font-semibold">Overall</span>
        <StatusBadge status={worst} />
      </section>

      <section aria-label="Background jobs" className="card">
        <h3 className="mb-1 text-base font-semibold">Background jobs</h3>
        <ul className="divide-y divide-gray-200">
          {data.jobs.map((j) => <JobRow key={j.name} j={j} />)}
        </ul>
      </section>

      <section aria-label="Database and connections" className="card grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">Database</h3>
          <StatusBadge status={data.database.status} />
        </div>
        <p className="text-sm text-gray-700">
          {data.database.responseMs !== null
            ? `Responded in ${data.database.responseMs} ms${data.database.status === 'late' ? ' (slow)' : ''}.`
            : `Not responding (${data.database.errorCode ?? 'unknown'}).`}
        </p>
        <p className="text-sm text-gray-700">
          Live connections: <span data-testid="sockets" className="font-semibold">{data.sockets ?? 'not available'}</span>
        </p>
      </section>

      <section aria-label="Server" className="card">
        <h3 className="mb-1 text-base font-semibold">Server</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-gray-600">Deployed version</dt>
          <dd className="font-mono">{data.build.commit ?? 'unknown'}{data.build.branch ? ` (${data.build.branch})` : ''}</dd>
          <dt className="text-gray-600">Running for</dt>
          <dd>{uptime(data.server.uptimeSeconds)}</dd>
          <dt className="text-gray-600">Memory</dt>
          <dd>{data.server.memoryMb} MB</dd>
          <dt className="text-gray-600">Node</dt>
          <dd>{data.server.nodeVersion}</dd>
          <dt className="text-gray-600">Environment</dt>
          <dd>{data.server.environment}</dd>
        </dl>
      </section>
    </div>
  );
}
