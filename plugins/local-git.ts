/**
 * A GitProvider that shells out to the real `git` binary on the server, against repositories
 * that live on the server's own filesystem — no remote host, no network call, no token needed.
 * Useful for a self-hosted deployment where "the repo" is just a bare or working copy sitting
 * next to the server process.
 *
 * `GitRepoLink.owner`/`repo`/`token` were shaped for hosted providers (GitHub, GitLab, ...) —
 * this provider reuses that same shape rather than changing the domain model for one provider:
 *   - `repo` is a path *relative to* LOCAL_GIT_ROOT (default: "<repo root>/local-repos"),
 *     e.g. repo: "my-project" resolves to "<LOCAL_GIT_ROOT>/my-project".
 *   - `owner` is ignored entirely.
 *   - `token` is ignored entirely (the link-creation form still requires *something* be typed
 *     into it, since that requirement lives in the generic route, not per-provider — type
 *     anything).
 *
 * `repo` is resolved and checked against LOCAL_GIT_ROOT before any `git` command runs — without
 * that check, a project's git link (writable by any authenticated user, not just admins) could
 * point this at an arbitrary path on the server and have it run `git` there.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { WorkhorsePlugin } from '../server/src/plugins/PluginContext';
import type { GitProvider } from '../server/src/services/GitProvider';

const execFileAsync = promisify(execFile);

const GIT_ROOT = resolve(process.env.LOCAL_GIT_ROOT?.trim() || join(process.cwd(), 'local-repos'));

function resolveRepoPath(repo: string): string {
  const resolved = resolve(GIT_ROOT, repo);
  if (resolved !== GIT_ROOT && !resolved.startsWith(GIT_ROOT + sep)) {
    throw new Error(`Repo path must stay within ${GIT_ROOT}`);
  }
  if (!existsSync(join(resolved, '.git'))) {
    throw new Error(`"${repo}" is not a git repository under ${GIT_ROOT} (no .git found)`);
  }
  return resolved;
}

async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoPath });
    return stdout.trim();
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    throw new Error(typeof stderr === 'string' && stderr.trim() ? stderr.trim() : err instanceof Error ? err.message : String(err));
  }
}

const localGitProvider: GitProvider = {
  id: 'local',

  async verifyAccess({ repo, branch }) {
    const repoPath = resolveRepoPath(repo);
    try {
      await git(repoPath, ['rev-parse', '--verify', `refs/heads/${branch}`]);
    } catch {
      throw new Error(`Branch "${branch}" not found in ${repoPath}`);
    }
  },

  async createBranch({ repo, fromBranch, newBranchName }) {
    const repoPath = resolveRepoPath(repo);
    await git(repoPath, ['branch', newBranchName, fromBranch]);
    return { url: `file://${join(repoPath)}` };
  },

  async readFile({ repo, branch, path }) {
    const repoPath = resolveRepoPath(repo);
    try {
      const content = await git(repoPath, ['show', `${branch}:${path}`]);
      return { content };
    } catch {
      throw new Error(`"${path}" not found on branch "${branch}" in ${repoPath}`);
    }
  },

  /**
   * Writes via a throwaway `git worktree` — never the repo's own working directory, which a
   * human may have checked out and be actively editing. The worktree is created fresh in a
   * temp dir, committed to, then removed; `branch` must already exist (EventEngine creates it
   * first via `createBranch` if needed — see applyAction's `writeRepoFile` case).
   */
  async writeFile({ repo, branch, path, content, commitMessage }) {
    const repoPath = resolveRepoPath(repo);
    const worktreeDir = resolve(await mkdtemp(join(tmpdir(), 'workhorse-git-')));
    try {
      await git(repoPath, ['worktree', 'add', '--quiet', worktreeDir, branch]);

      const filePath = resolve(worktreeDir, path);
      if (filePath !== worktreeDir && !filePath.startsWith(worktreeDir + sep)) {
        throw new Error(`File path must stay within the repository`);
      }
      await mkdir(dirname(filePath), { recursive: true });
      await fsWriteFile(filePath, content, 'utf8');

      await git(worktreeDir, ['add', '--', path]);
      await git(worktreeDir, ['-c', 'user.email=agent@workhorse.local', '-c', 'user.name=Workhorse Agent', 'commit', '-m', commitMessage]);
    } finally {
      await git(repoPath, ['worktree', 'remove', '--force', worktreeDir]).catch(() => {});
      await rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
    }
    return { url: `file://${repoPath}#${branch}` };
  },
};

const plugin: WorkhorsePlugin = {
  id: 'local',
  register(ctx) {
    ctx.registerGitProvider(localGitProvider);
  },
};
export default plugin;
