# Workhorse plugins

Workhorse is a headless system: `server/` is the actual product, `app/` is one reference client
built against its API — anyone can build a different UI, or none at all, against the same API.
This directory is the other half of that: how you extend the *server* itself (a git host, an
LLM backend, and whatever else gets a harness later) without forking the core repo.

## How it works

On boot, `server/src/plugins/loadPlugins.ts` scans this directory (top-level files only — a
plugin is one file, not a nested project) for `.ts`/`.js` modules. Each file must `export
default` an object matching:

```ts
interface WorkhorsePlugin {
  id: string; // only used in boot logs, to say what loaded
  register(ctx: PluginContext): void | Promise<void>;
}

interface PluginContext {
  registerGitProvider(provider: GitProvider): void;
  registerAgentRuntime(runtime: AgentRuntime): void;
}
```

`GitProvider` and `AgentRuntime` are defined in `server/src/services/GitProvider.ts` and
`server/src/services/AgentRuntime.ts` — read those files for the exact methods to implement.

A plugin that fails to load or register is logged and skipped; it does not stop the server from
starting. Drop a file here, restart the server, done — no edit to anything under `server/src/`.

By default this directory is empty: Workhorse ships zero git providers and one `AgentRuntime`
(`ollama`, registered directly in `container.ts` since agents need to work out of the box). Add
a git host by writing a `GitProvider` plugin; add a second LLM backend the same way.

Point at a different directory (e.g. a config volume outside this repo) with the `PLUGINS_DIR`
environment variable.

## Example: a minimal GitHub `GitProvider`

This is a complete, runnable plugin — copy it to `github.ts` in this directory to try it (it
uses only `fetch`, no extra dependency). Registered under the id `github`, so a project's git
link would use `provider: "github"`.

```ts
// plugins/github.ts
import type { WorkhorsePlugin } from '../server/src/plugins/PluginContext';
import type { GitProvider } from '../server/src/services/GitProvider';

const GITHUB_API = 'https://api.github.com';

function headers(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
}

const githubProvider: GitProvider = {
  id: 'github',

  async verifyAccess({ owner, repo, token, branch }) {
    const repoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: headers(token) });
    if (repoRes.status === 404) throw new Error(`Repository "${owner}/${repo}" not found, or this token can't see it`);
    if (repoRes.status === 401) throw new Error('GitHub rejected this token — check that it is valid and not expired');
    if (!repoRes.ok) throw new Error(`Could not verify repository access: ${repoRes.status}`);

    const refRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers: headers(token) });
    if (refRes.status === 404) throw new Error(`Branch "${branch}" not found in ${owner}/${repo}`);
    if (!refRes.ok) throw new Error(`Could not verify branch: ${refRes.status}`);
  },

  async createBranch({ owner, repo, token, fromBranch, newBranchName }) {
    const refRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`, { headers: headers(token) });
    if (!refRes.ok) throw new Error(`Could not look up "${fromBranch}": ${refRes.status}`);
    const { object } = (await refRes.json()) as { object: { sha: string } };

    const createRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${newBranchName}`, sha: object.sha }),
    });
    if (!createRes.ok) throw new Error(`Could not create branch: ${createRes.status}`);
    return { url: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(newBranchName)}` };
  },

  async readFile({ owner, repo, token, branch, path }) {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, { headers: headers(token) });
    if (res.status === 404) throw new Error(`"${path}" not found on branch "${branch}"`);
    if (!res.ok) throw new Error(`Could not read "${path}": ${res.status}`);
    const { content } = (await res.json()) as { content: string };
    return { content: Buffer.from(content, 'base64').toString('utf8') };
  },

  // The contents API upserts in one call, but needs the current file's blob sha to update an
  // existing file (omit it and GitHub 409s instead of overwriting) — so this always checks first.
  async writeFile({ owner, repo, token, branch, path, content, commitMessage }) {
    const existing = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, { headers: headers(token) });
    const sha = existing.ok ? ((await existing.json()) as { sha: string }).sha : undefined;

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify({ message: commitMessage, content: Buffer.from(content, 'utf8').toString('base64'), branch, sha }),
    });
    if (!res.ok) throw new Error(`Could not write "${path}": ${res.status}`);
    return { url: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${path}` };
  },
};

const plugin: WorkhorsePlugin = {
  id: 'github',
  register(ctx) {
    ctx.registerGitProvider(githubProvider);
  },
};
export default plugin;
```
