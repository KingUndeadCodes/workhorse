/**
 * A real hosted `GitProvider` (see GitProvider.ts) backed by the GitHub REST API — the first
 * concrete git host this app ships, alongside `local-git` (LocalGitProvider.ts). Registered
 * directly in container.ts the same way. Uses only `fetch`, no extra SDK dependency.
 */
import type { GitRepoSummary } from '../domain';
import { authToken, type GitProvider } from './GitProvider';

const GITHUB_API = 'https://api.github.com';

/** Encodes each `/`-separated segment but keeps the slashes — for branch names and file paths, which GitHub's API expects as real path segments. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * `<api>/repos/<owner>/<repo>`, after checking both are plain GitHub names. They arrive from
 * user input and are interpolated into a URL that is then called with the user's token, so a value
 * like `x/../../user` or `repo?x=` could otherwise change *which endpoint* gets called. `.` and `..`
 * pass the character check but are path-traversal segments, so they are rejected explicitly.
 */
function repoUrl(owner: string, repo: string): string {
  for (const [label, value] of [['owner', owner], ['repository', repo]] as const) {
    if (!/^[A-Za-z0-9._-]+$/.test(value) || /^\.+$/.test(value)) throw new Error(`Invalid ${label} name "${value}"`);
  }
  return `${GITHUB_API}/repos/${owner}/${repo}`;
}

function headers(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
}

export const githubProvider: GitProvider = {
  id: 'github',

  async identify(auth) {
    const res = await fetch(`${GITHUB_API}/user`, { headers: headers(authToken(auth)) });
    if (res.status === 401) throw new Error('GitHub rejected this token — check that it is valid and not expired');
    if (!res.ok) throw new Error(`Could not look up the GitHub account: ${res.status}`);
    return { login: ((await res.json()) as { login: string }).login };
  },

  // Capped at 3 pages (300 repos) — enough for a picker; anything beyond that is still linkable by typing.
  async listRepos(auth) {
    const token = authToken(auth);
    const repos: GitRepoSummary[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(`${GITHUB_API}/user/repos?per_page=100&sort=pushed&page=${page}`, { headers: headers(token) });
      if (res.status === 401) throw new Error('GitHub rejected this token — reconnect your account');
      if (!res.ok) throw new Error(`Could not list repositories: ${res.status}`);
      const batch = (await res.json()) as { name: string; owner: { login: string }; default_branch: string; private: boolean }[];
      repos.push(...batch.map((r) => ({ owner: r.owner.login, repo: r.name, defaultBranch: r.default_branch, private: r.private })));
      if (batch.length < 100) break;
    }
    return repos;
  },

  async verifyAccess({ owner, repo, auth, branch }) {
    const token = authToken(auth);
    const repoRes = await fetch(repoUrl(owner, repo), { headers: headers(token) });
    if (repoRes.status === 404) throw new Error(`Repository "${owner}/${repo}" not found, or this token can't see it`);
    if (repoRes.status === 401) throw new Error('GitHub rejected this token — check that it is valid and not expired');
    if (!repoRes.ok) throw new Error(`Could not verify repository access: ${repoRes.status}`);

    const refRes = await fetch(`${repoUrl(owner, repo)}/git/ref/heads/${encodePath(branch)}`, { headers: headers(token) });
    if (refRes.status === 404) throw new Error(`Branch "${branch}" not found in ${owner}/${repo}`);
    if (!refRes.ok) throw new Error(`Could not verify branch: ${refRes.status}`);
  },

  async createBranch({ owner, repo, auth, fromBranch, newBranchName }) {
    const token = authToken(auth);
    const refRes = await fetch(`${repoUrl(owner, repo)}/git/ref/heads/${encodePath(fromBranch)}`, { headers: headers(token) });
    if (!refRes.ok) throw new Error(`Could not look up "${fromBranch}": ${refRes.status}`);
    const { object } = (await refRes.json()) as { object: { sha: string } };

    const createRes = await fetch(`${repoUrl(owner, repo)}/git/refs`, {
      method: 'POST',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${newBranchName}`, sha: object.sha }),
    });
    if (!createRes.ok) throw new Error(`Could not create branch: ${createRes.status}`);
    return { url: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(newBranchName)}` };
  },

  async readFile({ owner, repo, auth, branch, path }) {
    const token = authToken(auth);
    const res = await fetch(`${repoUrl(owner, repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`, { headers: headers(token) });
    if (res.status === 404) throw new Error(`"${path}" not found on branch "${branch}"`);
    if (!res.ok) throw new Error(`Could not read "${path}": ${res.status}`);
    const { content } = (await res.json()) as { content: string };
    return { content: Buffer.from(content, 'base64').toString('utf8') };
  },

  // The contents API upserts in one call, but needs the current file's blob sha to update an
  // existing file (omit it and GitHub 409s instead of overwriting) — so this always checks first.
  // Only a 404 means "doesn't exist yet"; any other failure (401/403/5xx) is the check itself
  // failing and must not be silently treated as "create a new file".
  async writeFile({ owner, repo, auth, branch, path, content, commitMessage }) {
    const token = authToken(auth);
    const existing = await fetch(`${repoUrl(owner, repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`, { headers: headers(token) });
    if (!existing.ok && existing.status !== 404) throw new Error(`Could not check whether "${path}" already exists: ${existing.status}`);
    const sha = existing.ok ? ((await existing.json()) as { sha: string }).sha : undefined;

    const res = await fetch(`${repoUrl(owner, repo)}/contents/${encodePath(path)}`, {
      method: 'PUT',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify({ message: commitMessage, content: Buffer.from(content, 'utf8').toString('base64'), branch, sha }),
    });
    if (!res.ok) throw new Error(`Could not write "${path}": ${res.status}`);
    return { url: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${encodePath(path)}` };
  },
};
