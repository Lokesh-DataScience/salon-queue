// frontend/src/components/admin/CodeHistoryPanel.tsx
// Tech tab: the last 30 commits on GitHub, which one is live, and what isn't deployed yet.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchGitHistory, type CommitItem, type CommitState, type GitHistory } from '../../api/admin';
import { ago } from './TechPanel';

const KEY = ['techCommits'];

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

const BADGE: Partial<Record<CommitState, { text: string; cls: string }>> = {
  not_deployed: { text: 'Not deployed', cls: 'border-amber-400 bg-amber-50 text-amber-900' },
  live: { text: 'Live now', cls: 'border-green-600 bg-green-50 text-green-900' },
};

type Configured = Extract<GitHistory, { configured: true }>;

function Summary({ h }: { h: Configured }) {
  let text: string;
  let cls = 'border-gray-300 bg-gray-50 text-gray-800';
  if (!h.deployedCommit) {
    text = "Can't tell which version is live here (normal on your laptop — Render provides it).";
  } else if (!h.deployedInList) {
    text = `The live version (${h.deployedCommit}) is not in the last 30 commits on ${h.branch}. Production is more than 30 commits behind, or was deployed from another branch.`;
    cls = 'border-amber-400 bg-amber-50 text-amber-900';
  } else if (h.notDeployed === 0) {
    text = `Production is up to date with ${h.branch}.`;
    cls = 'border-green-600 bg-green-50 text-green-900';
  } else {
    const n = h.notDeployed ?? 0;
    text = `${n} ${n === 1 ? 'commit' : 'commits'} on ${h.branch} not deployed yet.`;
    cls = 'border-amber-400 bg-amber-50 text-amber-900';
  }
  return (
    <section aria-label="Deploy status" className={`rounded-xl border-2 p-3 text-base font-semibold ${cls}`}>
      {text}
    </section>
  );
}

function CommitRow({ c }: { c: CommitItem }) {
  const badge = BADGE[c.state];
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-mono text-sm font-semibold underline">
          {c.shortSha}
        </a>
        {badge && <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${badge.cls}`}>{badge.text}</span>}
      </div>
      <p className="break-words font-medium">{c.message}</p>
      <p className="text-xs text-gray-600">
        {c.author} · <time dateTime={c.date} title={new Date(c.date).toLocaleString('en-IN')}>{ago(c.date)}</time>
      </p>
    </li>
  );
}

export default function CodeHistoryPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => fetchGitHistory(),
    staleTime: 60_000,
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: () => fetchGitHistory(true),
    onSuccess: (fresh) => qc.setQueryData(KEY, fresh),
  });

  if (isLoading) return <p role="status" className="text-gray-600">Loading code history...</p>;
  if (!data) {
    return (
      <div className="card text-center">
        <p role="alert" className="mb-4 text-red-700">{errText(error)}</p>
        <button type="button" className="btn-primary" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }
  if (!data.configured) {
    return (
      <div className="card">
        <p className="text-gray-700">{data.reason}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          <span className="font-mono">{data.repo}</span> · {data.branch} · fetched {ago(data.fetchedAt)}
        </p>
        <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-busy={refresh.isPending}
          className="btn-secondary min-h-11 px-4 text-sm">
          {refresh.isPending ? 'Checking...' : 'Check now'}
        </button>
      </div>
      {(data.warning || refresh.isError) && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-center text-sm text-amber-900">
          {data.warning ?? errText(refresh.error)} Showing the last list.
        </p>
      )}

      <Summary h={data} />

      <section aria-label="Recent commits" className="card">
        <h3 className="mb-1 text-base font-semibold">Recent commits</h3>
        {data.commits.length === 0 ? (
          <p className="text-sm text-gray-600">No commits found on {data.branch}.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {data.commits.map((c) => <CommitRow key={c.sha} c={c} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
