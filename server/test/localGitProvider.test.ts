import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitProvider } from '../src/services/GitProvider';
import { isValidBranchName } from '../src/services/branchName';

// Real git, real temp repos: argument injection and symlink escapes are about what the git binary and the
// filesystem actually do, so a mock would prove nothing. LOCAL_GIT_ROOT is read when the module loads.
const root = mkdtempSync(join(tmpdir(), 'workhorse-local-git-'));
let provider: GitProvider;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const branches = (repo: string) => git(join(root, repo), 'branch', '--format=%(refname:short)').split('\n').sort();
const opts = { owner: 'ignored', auth: { kind: 'token', token: '' } } as const;

beforeAll(async () => {
  vi.stubEnv('LOCAL_GIT_ROOT', root);
  provider = (await import('../src/services/LocalGitProvider')).localGitProvider;
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

let repo: string;
let n = 0;
beforeEach(() => {
  repo = `repo${n++}`;
  const path = join(root, repo);
  mkdirSync(path);
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'config', 'user.email', 't@example.com');
  git(path, 'config', 'user.name', 'T');
  writeFileSync(join(path, 'README.md'), 'hello\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'init');
});

describe('isValidBranchName', () => {
  it.each(['main', 'issue/PRJ-142-fix-login', 'release/1.0', 'feat_x', 'a'])('accepts %s', (name) => expect(isValidBranchName(name)).toBe(true));
  it.each(['', '-D', '--force', '-f', '/abs', 'trailing/', 'a..b', 'a//b', 'a/.hidden', 'x.lock', 'ends.', 'has space', 'semi;colon', 'new\nline', 'tab\t', 'back\\slash', 'a'.repeat(201)])(
    'rejects %j',
    (name) => expect(isValidBranchName(name)).toBe(false),
  );
});

describe('LocalGitProvider branch handling (argument injection)', () => {
  it('createBranch really creates a branch off the source branch', async () => {
    await provider.createBranch({ ...opts, repo, fromBranch: 'main', newBranchName: 'issue/PRJ-1-thing' });
    expect(branches(repo)).toEqual(['issue/PRJ-1-thing', 'main']);
  });

  it.each(['-D', '-f', '--delete', '-m'])('refuses a branch named %s instead of letting git read it as an option — main must survive', async (name) => {
    await expect(provider.createBranch({ ...opts, repo, fromBranch: 'main', newBranchName: name })).rejects.toThrow(/Invalid branch name/);
    expect(branches(repo)).toEqual(['main']);
  });

  it('refuses a flag as the source branch too', async () => {
    await expect(provider.createBranch({ ...opts, repo, fromBranch: '-D', newBranchName: 'ok' })).rejects.toThrow(/Invalid branch name/);
    expect(branches(repo)).toEqual(['main']);
  });

  it('refuses an invalid branch on verifyAccess, readFile and writeFile', async () => {
    await expect(provider.verifyAccess({ ...opts, repo, branch: '-D' })).rejects.toThrow(/Invalid branch name/);
    await expect(provider.readFile({ ...opts, repo, branch: '--help', path: 'README.md' })).rejects.toThrow(/Invalid branch name/);
    await expect(provider.writeFile({ ...opts, repo, branch: '-f', path: 'a', content: 'x', commitMessage: 'm' })).rejects.toThrow(/Invalid branch name/);
    expect(branches(repo)).toEqual(['main']);
  });

  it('still reads and verifies on a legitimate branch', async () => {
    await expect(provider.verifyAccess({ ...opts, repo, branch: 'main' })).resolves.toBeUndefined();
    expect((await provider.readFile({ ...opts, repo, branch: 'main', path: 'README.md' })).content).toBe('hello');
  });
});

describe('LocalGitProvider.writeFile', () => {
  const write = (path: string, branch = 'work') => provider.writeFile({ ...opts, repo, branch, path, content: 'agent text', commitMessage: 'by agent' });
  beforeEach(async () => {
    await provider.createBranch({ ...opts, repo, fromBranch: 'main', newBranchName: 'work' });
  });

  it('commits a new nested file to the branch, leaving main untouched', async () => {
    await write('docs/notes/a.md');
    expect(git(join(root, repo), 'show', 'work:docs/notes/a.md')).toBe('agent text');
    expect(git(join(root, repo), 'ls-tree', '-r', '--name-only', 'main')).toBe('README.md');
  });

  it('cannot write outside the repository with ../', async () => {
    await expect(write('../escaped.txt')).rejects.toThrow(/stay within the repository/);
  });

  it('cannot write through a committed symlink to a directory outside the worktree', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'workhorse-outside-'));
    try {
      symlinkSync(outside, join(root, repo, 'docs'));
      git(join(root, repo), 'add', '.');
      git(join(root, repo), 'commit', '-q', '-m', 'add docs link');
      await provider.createBranch({ ...opts, repo, fromBranch: 'main', newBranchName: 'linked' });

      await expect(write('docs/pwned.txt', 'linked')).rejects.toThrow(/symbolic link/);
      await expect(write('docs/deep/er/pwned.txt', 'linked')).rejects.toThrow(/symbolic link/);

      expect(existsSync(join(outside, 'pwned.txt'))).toBe(false);
      expect(existsSync(join(outside, 'deep'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('cannot overwrite a committed symlinked file that points outside', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'workhorse-outside-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'original');
      symlinkSync(join(outside, 'secret.txt'), join(root, repo, 'link.txt'));
      git(join(root, repo), 'add', '.');
      git(join(root, repo), 'commit', '-q', '-m', 'add file link');
      await provider.createBranch({ ...opts, repo, fromBranch: 'main', newBranchName: 'linked' });

      await expect(write('link.txt', 'linked')).rejects.toThrow(/symbolic link/);

      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('original');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('LocalGitProvider.deleteBranch', () => {
  it('deletes a branch the app created', async () => {
    await provider.createBranch({ ...opts, repo, fromBranch: 'main', newBranchName: 'issue/PRJ-9-temp' });
    expect(branches(repo)).toContain('issue/PRJ-9-temp');

    await provider.deleteBranch!({ ...opts, repo, branchName: 'issue/PRJ-9-temp' });

    expect(branches(repo)).toEqual(['main']);
  });

  it.each(['-D', '--force', 'a..b'])('refuses %s instead of passing it to git as an option', async (name) => {
    await expect(provider.deleteBranch!({ ...opts, repo, branchName: name })).rejects.toThrow(/Invalid branch name/);
    expect(branches(repo)).toEqual(['main']);
  });
});
