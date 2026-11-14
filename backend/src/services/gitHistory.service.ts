// backend/src/services/gitHistory.service.ts
// Tech tab "Code history": the latest commits on GitHub, and which one is live on this server.
//
// - Public repo: no token needed. GitHub allows 60 unauthenticated calls per hour per server IP,
//   so answers are cached for 5 minutes and "Check now" can refresh at most every 30 seconds.
// - The live commit comes from Render's RENDER_GIT_COMMIT. On a laptop it is empty, so the panel
//   just lists commits without "Live now / Not deployed".
// - Only the first line of each message and the author's display name are returned. Never emails.
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

export const COMMIT_LIMIT = 30;
const DEFAULT_CACHE_MS = 5 * 60_000;
const DEFAULT_MIN_REFRESH_MS = 30_000;
const TIMEOUT_MS = 8_000;

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;
const FULL_SHA_RE = /^[0-9a-f]{40}$/i;
const SHA_PREFIX_RE = /^[0-9a-f]{7,40}$/i;

export type CommitState = 'not_deployed' | 'live' | 'older' | 'unknown';

export interface ParsedCommit {
  sha: string;
  shortSha: string;
  message: string; // first line only
  author: string; // display name only
  date: string; // ISO
  url: string;
}

export interface CommitItem extends ParsedCommit {
  state: CommitState;
}

export interface GitHistory {
  configured: true;
  repo: string;
  branch: string;
  deployedCommit: string | null; // short sha of what this server runs
  deployedInList: boolean;
  notDeployed: number | null; // commits newer than the live one; null = can't tell
  fetchedAt: string;
  stale: boolean; // GitHub failed, showing the last good answer
  warning: string | null;
  commits: CommitItem[];
}

export type GitHistoryResult = GitHistory | { configured: false; reason: string };

// ── Parsing (pure, tested directly) ───────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function parseCommits(raw: unknown, repo: string): ParsedCommit[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedCommit[] = [];
  for (const c of raw.slice(0, COMMIT_LIMIT)) {
    const sha = str(c?.sha).toLowerCase();
    if (!FULL_SHA_RE.test(sha)) continue;
    const firstLine = str(c?.commit?.message).split(/\r?\n/)[0].trim();
    const author = (str(c?.commit?.author?.name) || str(c?.author?.login) || 'unknown').trim().slice(0, 80);
    const date = str(c?.commit?.committer?.date) || str(c?.commit?.author?.date);
    out.push({
      sha,
      shortSha: sha.slice(0, 7),
      message: (firstLine || '(no message)').slice(0, 200),
      author,
      date: Number.isNaN(Date.parse(date)) ? new Date(0).toISOString() : new Date(date).toISOString(),
      url: `https://github.com/${repo}/commit/${sha}`,
    });
  }
  return out;
}

// Newest first, as GitHub returns them. Everything above the live commit is "not deployed".
export function markDeployed(commits: ParsedCommit[], deployedSha: string | null) {
  const d = deployedSha && SHA_PREFIX_RE.test(deployedSha) ? deployedSha.toLowerCase() : null;
  const liveIndex = d ? commits.findIndex((c) => c.sha.startsWith(d)) : -1;
  const items: CommitItem[] = commits.map((c, i) => ({
    ...c,
    state: liveIndex === -1 ? 'unknown' : i < liveIndex ? 'not_deployed' : i === liveIndex ? 'live' : 'older',
  }));
  return {
    deployedCommit: d ? d.slice(0, 7) : null,
    deployedInList: liveIndex !== -1,
    notDeployed: liveIndex === -1 ? null : liveIndex,
    commits: items,
  };
}

// ── Configuration ─────────────────────────────────────────────────────────

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

interface TestOverrides {
  repo?: string | null;
  branch?: string;
  deployedSha?: string | null;
  fetcher?: Fetcher;
  cacheMs?: number;
  minRefreshMs?: number;
}

let overrides: TestOverrides | null = null;

// Tests only: fake GitHub, repo and live commit. Pass null to go back to the real settings.
export function __setGitTestOverrides(o: TestOverrides | null) {
  overrides = o;
  cache = null;
  inflight = null;
}

function config() {
  const o = overrides ?? {};
  const repo = 'repo' in o ? o.repo ?? null : env.GITHUB_REPO ?? process.env.RENDER_GIT_REPO_SLUG ?? null;
  const branch = o.branch ?? env.GITHUB_BRANCH ?? process.env.RENDER_GIT_BRANCH ?? 'main';
  const deployedSha = 'deployedSha' in o ? o.deployedSha ?? null : process.env.RENDER_GIT_COMMIT ?? null;
  return {
    repo: repo && REPO_RE.test(repo) ? repo : null,
    branch: BRANCH_RE.test(branch) ? branch : 'main',
    deployedSha,
    fetcher: o.fetcher ?? fetch,
    cacheMs: o.cacheMs ?? DEFAULT_CACHE_MS,
    minRefreshMs: o.minRefreshMs ?? DEFAULT_MIN_REFRESH_MS,
  };
}

// ── GitHub call + cache ───────────────────────────────────────────────────

const MESSAGES = {
  unreachable: "Couldn't reach GitHub. Try again in a minute.",
  notFound: "GitHub can't find this repository. Check GITHUB_REPO (owner/name) and that the repo is public.",
  rateLimited: "GitHub's hourly limit for this server was reached. Try again later.",
  other: 'GitHub gave an unexpected answer.',
};

class GitHubError extends Error {}

async function fetchFromGitHub(cfg: ReturnType<typeof config>): Promise<ParsedCommit[]> {
  const repo = cfg.repo as string;
  const url = `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(cfg.branch)}&per_page=${COMMIT_LIMIT}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': env.OUTBOUND_USER_AGENT,
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  let res: Response;
  try {
    res = await cfg.fetcher(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GitHubError(MESSAGES.unreachable);
  }
  if (res.status === 404 || res.status === 422) throw new GitHubError(MESSAGES.notFound);
  if (res.status === 403 || res.status === 429) throw new GitHubError(MESSAGES.rateLimited);
  if (!res.ok) throw new GitHubError(`${MESSAGES.other} (HTTP ${res.status})`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GitHubError(MESSAGES.other);
  }
  return parseCommits(body, repo);
}

let cache: { key: string; at: number; commits: ParsedCommit[] } | null = null;
let inflight: { key: string; promise: Promise<ParsedCommit[]> } | null = null;

export async function getGitHistory(opts: { refresh?: boolean } = {}): Promise<GitHistoryResult> {
  const cfg = config();
  if (!cfg.repo) {
    return { configured: false, reason: 'Set GITHUB_REPO (owner/name) on the server to show code history.' };
  }

  const key = `${cfg.repo}@${cfg.branch}`;
  const now = Date.now();
  const respond = (commits: ParsedCommit[], at: number, warning: string | null): GitHistory => ({
    configured: true,
    repo: cfg.repo as string,
    branch: cfg.branch,
    fetchedAt: new Date(at).toISOString(),
    stale: warning !== null,
    warning,
    ...markDeployed(commits, cfg.deployedSha),
  });

  if (cache && cache.key === key) {
    const age = now - cache.at;
    const wantsRefresh = opts.refresh && age >= cfg.minRefreshMs;
    if (age < cfg.cacheMs && !wantsRefresh) return respond(cache.commits, cache.at, null);
  }

  try {
    // Several admins opening the tab at once share one GitHub call.
    if (!inflight || inflight.key !== key) {
      const promise = fetchFromGitHub(cfg).finally(() => {
        if (inflight?.promise === promise) inflight = null;
      });
      inflight = { key, promise };
    }
    const commits = await inflight.promise;
    cache = { key, at: Date.now(), commits };
    return respond(commits, cache.at, null);
  } catch (err) {
    const message = err instanceof GitHubError ? err.message : MESSAGES.other;
    if (cache && cache.key === key) return respond(cache.commits, cache.at, message);
    throw new AppError(message, 502);
  }
}
