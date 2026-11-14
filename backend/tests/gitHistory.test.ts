// backend/tests/gitHistory.test.ts — Tech tab: code history (GitHub commits + live version).
// Run this file on its own. GitHub is faked: no real network calls.
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { app, makeSalon, cleanupSalons, barberCookieFor } from './helpers';
import { supabase } from '../src/config/supabase';
import { parseCommits, markDeployed, __setGitTestOverrides } from '../src/services/gitHistory.service';

const REPO = 'someone/salon-queue';
const sha = (n: number) => n.toString(16).padStart(40, 'a');

const rawCommit = (n: number, message = `Commit ${n}\n\nLonger body with 9876543210 in it`) => ({
  sha: sha(n),
  commit: {
    message,
    author: { name: `Dev ${n}`, email: `dev${n}@example.com`, date: '2026-11-14T10:00:00Z' },
    committer: { name: 'GitHub', email: 'noreply@github.com', date: `2026-11-14T10:${String(60 - n).padStart(2, '0')}:00Z` },
  },
  author: { login: `dev${n}` },
});
const FIVE = [1, 2, 3, 4, 5].map((n) => rawCommit(n)); // newest first

function fakeGitHub(body: unknown = FIVE) {
  const state = { status: 200, calls: 0 };
  const fetcher = async () => {
    state.calls++;
    return new Response(JSON.stringify(body), { status: state.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetcher, state };
}

async function admin(role: 'TECH' | 'SALES') {
  const cookie = await barberCookieFor(await makeSalon({ is_internal: true }));
  const me = await request(app).get('/api/barber/me').set('Cookie', cookie);
  const { error } = await supabase.from('staff_admin_roles').upsert({ staff_id: me.body.staff.id, role });
  if (error) throw new Error(error.message);
  return cookie;
}

const commits = (cookie: string, q = '') => request(app).get(`/api/admin/tech/commits${q}`).set('Cookie', cookie);

afterEach(() => __setGitTestOverrides(null));
afterAll(cleanupSalons);

describe('Code history: parsing', () => {
  it('keeps only the first message line and the display name — never emails', () => {
    const list = parseCommits([...FIVE, { sha: 'not-a-sha' }, null], REPO);
    expect(list).toHaveLength(5);
    expect(list[0]).toEqual({
      sha: sha(1),
      shortSha: sha(1).slice(0, 7),
      message: 'Commit 1',
      author: 'Dev 1',
      date: '2026-11-14T10:59:00.000Z',
      url: `https://github.com/${REPO}/commit/${sha(1)}`,
    });
    expect(JSON.stringify(list)).not.toMatch(/@example\.com|noreply@|9876543210/);
    expect(parseCommits({ message: 'Not Found' }, REPO)).toEqual([]);
  });

  it('marks newer commits as not deployed, the live one, and older ones', () => {
    const list = parseCommits(FIVE, REPO);
    const m = markDeployed(list, sha(3));
    expect(m.notDeployed).toBe(2);
    expect(m.deployedInList).toBe(true);
    expect(m.deployedCommit).toBe(sha(3).slice(0, 7));
    expect(m.commits.map((c) => c.state)).toEqual(['not_deployed', 'not_deployed', 'live', 'older', 'older']);

    expect(markDeployed(list, sha(1)).notDeployed).toBe(0);

    const local = markDeployed(list, null); // laptop: no RENDER_GIT_COMMIT
    expect(local.notDeployed).toBeNull();
    expect(local.commits.every((c) => c.state === 'unknown')).toBe(true);

    const far = markDeployed(list, sha(99)); // live version is older than the last 30
    expect(far.deployedInList).toBe(false);
    expect(far.notDeployed).toBeNull();
  });
});

describe('Code history: route', () => {
  it('is for TECH (and FOUNDER) only', async () => {
    const gh = fakeGitHub();
    __setGitTestOverrides({ repo: REPO, deployedSha: sha(3), fetcher: gh.fetcher });
    expect((await commits(await admin('SALES'))).status).toBe(404);
    expect(gh.state.calls).toBe(0);
  }, 120_000);

  it('returns commits with the live marker, cached for repeat visits', async () => {
    const gh = fakeGitHub();
    __setGitTestOverrides({ repo: REPO, branch: 'main', deployedSha: sha(3), fetcher: gh.fetcher });
    const tech = await admin('TECH');

    const res = await commits(tech);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, repo: REPO, branch: 'main', notDeployed: 2, stale: false });
    expect(res.body.commits[2]).toMatchObject({ state: 'live', message: 'Commit 3' });
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com|9876543210/);

    await commits(tech);
    await commits(tech, '?refresh=1'); // too soon after the last call: still cached
    expect(gh.state.calls).toBe(1);

    expect((await commits(tech, '?refresh=yes')).status).toBe(400);
  }, 120_000);

  it('says what to set when no repo is configured', async () => {
    __setGitTestOverrides({ repo: null });
    const res = await commits(await admin('TECH'));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.reason).toMatch(/GITHUB_REPO/);
  }, 120_000);

  it('GitHub down: friendly 502 first time, last good list (marked stale) after that', async () => {
    const gh = fakeGitHub();
    __setGitTestOverrides({ repo: REPO, deployedSha: sha(1), fetcher: gh.fetcher, cacheMs: 0, minRefreshMs: 0 });
    const tech = await admin('TECH');

    gh.state.status = 403;
    const limited = await commits(tech);
    expect(limited.status).toBe(502);
    expect(limited.body.message).toMatch(/hourly limit/i);

    gh.state.status = 200;
    expect((await commits(tech)).body.stale).toBe(false);

    gh.state.status = 500;
    const stale = await commits(tech);
    expect(stale.status).toBe(200);
    expect(stale.body.stale).toBe(true);
    expect(stale.body.warning).toMatch(/unexpected answer/i);
    expect(stale.body.commits).toHaveLength(5);
  }, 120_000);
});
