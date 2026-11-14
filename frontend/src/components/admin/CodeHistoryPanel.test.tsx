// frontend/src/components/admin/CodeHistoryPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CodeHistoryPanel from './CodeHistoryPanel';
import { renderPage } from '../../test/utils';
import * as admin from '../../api/admin';
import type { CommitItem, GitHistory } from '../../api/admin';

vi.mock('../../api/admin', () => ({ fetchGitHistory: vi.fn(), fetchTechHealth: vi.fn() }));

const now = new Date().toISOString();
const commit = (n: number, state: CommitItem['state']): CommitItem => ({
  sha: `${n}`.padStart(40, 'a'),
  shortSha: `aaaaaa${n}`,
  message: `Commit ${n}`,
  author: `Dev ${n}`,
  date: now,
  url: `https://github.com/someone/salon-queue/commit/${`${n}`.padStart(40, 'a')}`,
  state,
});

function sample(over: Partial<Extract<GitHistory, { configured: true }>> = {}): GitHistory {
  return {
    configured: true,
    repo: 'someone/salon-queue',
    branch: 'main',
    deployedCommit: 'aaaaaa3',
    deployedInList: true,
    notDeployed: 2,
    fetchedAt: now,
    stale: false,
    warning: null,
    commits: [commit(1, 'not_deployed'), commit(2, 'not_deployed'), commit(3, 'live'), commit(4, 'older')],
    ...over,
  };
}

const renderIt = () => renderPage(<CodeHistoryPanel />, { path: '/barber/admin', route: '/barber/admin' });

beforeEach(() => {
  vi.mocked(admin.fetchGitHistory).mockReset().mockResolvedValue(sample());
});

describe('CodeHistoryPanel', () => {
  it('shows what is not deployed and which commit is live', async () => {
    renderIt();
    expect(await screen.findByRole('region', { name: 'Deploy status' })).toHaveTextContent('2 commits on main not deployed yet.');
    const list = screen.getByRole('region', { name: 'Recent commits' });
    expect(within(list).getAllByText('Not deployed')).toHaveLength(2);
    expect(within(list).getAllByText('Live now')).toHaveLength(1);
    expect(within(list).getByRole('link', { name: 'aaaaaa3' })).toHaveAttribute(
      'href',
      `https://github.com/someone/salon-queue/commit/${'3'.padStart(40, 'a')}`,
    );
    expect(within(list).getByText('Commit 4')).toBeInTheDocument();
  });

  it('says production is up to date', async () => {
    vi.mocked(admin.fetchGitHistory).mockResolvedValue(
      sample({ notDeployed: 0, deployedCommit: 'aaaaaa1', commits: [commit(1, 'live'), commit(2, 'older')] }),
    );
    renderIt();
    expect(await screen.findByRole('region', { name: 'Deploy status' })).toHaveTextContent('Production is up to date with main.');
  });

  it('explains when the live version is unknown (laptop)', async () => {
    vi.mocked(admin.fetchGitHistory).mockResolvedValue(
      sample({ deployedCommit: null, deployedInList: false, notDeployed: null, commits: [commit(1, 'unknown')] }),
    );
    renderIt();
    expect(await screen.findByRole('region', { name: 'Deploy status' })).toHaveTextContent(/can't tell which version is live/i);
    expect(screen.queryByText('Live now')).not.toBeInTheDocument();
  });

  it('shows the setup hint when no repo is configured', async () => {
    vi.mocked(admin.fetchGitHistory).mockResolvedValue({ configured: false, reason: 'Set GITHUB_REPO (owner/name) on the server.' });
    renderIt();
    expect(await screen.findByText(/set github_repo/i)).toBeInTheDocument();
  });

  it("shows the server's message when GitHub can't be reached", async () => {
    vi.mocked(admin.fetchGitHistory).mockRejectedValue(new Error("Couldn't reach GitHub. Try again in a minute."));
    renderIt();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't reach github/i);
  });

  it('shows a stale warning but keeps the list', async () => {
    vi.mocked(admin.fetchGitHistory).mockResolvedValue(sample({ stale: true, warning: "GitHub's hourly limit for this server was reached." }));
    renderIt();
    expect(await screen.findByRole('alert')).toHaveTextContent(/hourly limit.*showing the last list/i);
    expect(screen.getByText('Commit 1')).toBeInTheDocument();
  });

  it('"Check now" asks the server for a fresh list', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('region', { name: 'Deploy status' });
    vi.mocked(admin.fetchGitHistory).mockResolvedValue(
      sample({ notDeployed: 0, deployedCommit: 'aaaaaa1', commits: [commit(1, 'live')] }),
    );
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(admin.fetchGitHistory).toHaveBeenLastCalledWith(true);
    expect(await screen.findByText('Production is up to date with main.')).toBeInTheDocument();
  });
});
