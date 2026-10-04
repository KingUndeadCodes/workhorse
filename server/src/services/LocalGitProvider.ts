/**
 * A GitProvider that shells out to the real `git` binary on the server, against repositories
 * that live on the server's own filesystem — no remote host, no network call, no token needed.
 * Useful for a self-hosted deployment where "the repo" is just a bare or working copy sitting
 * next to the server process. Registered directly in container.ts (see `gitProviders`'s doc
 * comment there) — a second git host (GitHub, GitLab, ...) would be added the same way: a new
 * `GitProvider` implementation, registered alongside this one.
 *
 * `GitRepoLink.owner`/`repo`/`auth` were shaped for hosted providers (GitHub, GitLab, ...) —
 * this provider reuses that same shape rather than changing the domain model for one provider:
 *   - `repo` is a path *relative to* LOCAL_GIT_ROOT (default: "<repo root>/local-repos"),
 *     e.g. repo: "my-project" resolves to "<LOCAL_GIT_ROOT>/my-project".
 *   - `owner` is ignored entirely.
 *   - `auth` is ignored entirely — `GitAuthResolver` hands `local` an empty placeholder, so no
 *     account connection is needed to link or use a local repo.
 *
 * `repo` is resolved and checked against LOCAL_GIT_ROOT before any `git` command runs — without
 * that check, a project's git link (writable by any authenticated user, not just admins) could
 * point this at an arbitrary path on the server and have it run `git` there.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { assertValidBranchName } from './branchName';
import type { GitProvider } from './GitProvider';

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

/**
 * Refuses a path that runs through an existing symbolic link. The path string passes the "stays inside
 * the worktree" check even when a committed link such as `docs -> /home/app` points outside it, and
 * `writeFile`/`mkdir` follow links — so an agent-written file could land anywhere the server process can
 * write. Each existing component is checked with `lstat` (which doesn't follow); once a component doesn't
 * exist, nothing beyond it can be a link, so it's safe to create.
 */
async function assertNoSymlinkInPath(root: string, relPath: string): Promise<void> {
  let current = root;
  for (const segment of relPath.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`"${relPath}" passes through a symbolic link, which can't be written through`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }
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

export const localGitProvider: GitProvider = {
  id: 'local',

  async verifyAccess({ repo, branch }) {
    assertValidBranchName(branch);
    const repoPath = resolveRepoPath(repo);
    try {
      await git(repoPath, ['rev-parse', '--verify', `refs/heads/${branch}`]);
    } catch {
      throw new Error(`Branch "${branch}" not found in ${repoPath}`);
    }
  },

  async createBranch({ repo, fromBranch, newBranchName }) {
    assertValidBranchName(newBranchName);
    assertValidBranchName(fromBranch);
    const repoPath = resolveRepoPath(repo);
    // `--` ends option parsing, so even a name that slipped past validation can't be read as a flag.
    await git(repoPath, ['branch', '--', newBranchName, fromBranch]);
    return { url: `file://${join(repoPath)}` };
  },

  async deleteBranch({ repo, branchName }) {
    assertValidBranchName(branchName);
    await git(resolveRepoPath(repo), ['branch', '-D', '--', branchName]);
  },

  async readFile({ repo, branch, path }) {
    assertValidBranchName(branch);
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
    assertValidBranchName(branch);
    const repoPath = resolveRepoPath(repo);
    const worktreeDir = resolve(await mkdtemp(join(tmpdir(), 'workhorse-git-')));
    try {
      await git(repoPath, ['worktree', 'add', '--quiet', '--', worktreeDir, branch]);

      const filePath = resolve(worktreeDir, path);
      if (filePath !== worktreeDir && !filePath.startsWith(worktreeDir + sep)) {
        throw new Error(`File path must stay within the repository`);
      }
      await assertNoSymlinkInPath(worktreeDir, path);
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
