import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubProvider } from '../src/services/GitHubProvider';

const auth = { kind: 'oauth', accessToken: 'gho_x' } as const;
const repo = (name: string) => ({ name, owner: { login: 'acme' }, default_branch: 'main', private: name.startsWith('p') });

afterEach(() => vi.unstubAllGlobals());

describe('githubProvider.listRepos', () => {
  it('maps GitHub repos and sends the bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([repo('widgets'), repo('private-thing')]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await githubProvider.listRepos!(auth)).toEqual([
      { owner: 'acme', repo: 'widgets', defaultBranch: 'main', private: false },
      { owner: 'acme', repo: 'private-thing', defaultBranch: 'main', private: true },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/user/repos');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gho_x');
  });

  it('follows pages while they are full, up to 3', async () => {
    const full = Array.from({ length: 100 }, (_, i) => repo(`r${i}`));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(full), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await githubProvider.listRepos!(auth)).length).toBe(300);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops after a short page', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([repo('one')]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await githubProvider.listRepos!(auth);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tells the user to reconnect on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(githubProvider.listRepos!(auth)).rejects.toThrow(/reconnect/);
  });
});

describe('githubProvider.identify', () => {
  it('returns the login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200 })));
    expect(await githubProvider.identify!(auth)).toEqual({ login: 'octocat' });
  });

  it('rejects a bad token with a clear message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(githubProvider.identify!(auth)).rejects.toThrow(/rejected this token/);
  });
});

describe('githubProvider.verifyAccess', () => {
  const opts = { owner: 'acme', repo: 'widgets', auth, branch: 'main' };
  const respond = (...statuses: number[]) => {
    const queue = [...statuses];
    return vi.fn(async () => new Response('{}', { status: queue.shift() ?? 200 }));
  };

  it('passes when both the repo and the branch exist', async () => {
    const fetchMock = respond(200, 200);
    vi.stubGlobal('fetch', fetchMock);

    await expect(githubProvider.verifyAccess(opts)).resolves.toBeUndefined();
    expect((fetchMock.mock.calls as unknown as [string][]).map(([u]) => u)).toEqual([
      'https://api.github.com/repos/acme/widgets',
      'https://api.github.com/repos/acme/widgets/git/ref/heads/main',
    ]);
  });

  it('explains a missing repo, a rejected token, and a missing branch distinctly', async () => {
    vi.stubGlobal('fetch', respond(404));
    await expect(githubProvider.verifyAccess(opts)).rejects.toThrow(/not found, or this token can't see it/);
    vi.stubGlobal('fetch', respond(401));
    await expect(githubProvider.verifyAccess(opts)).rejects.toThrow(/rejected this token/);
    vi.stubGlobal('fetch', respond(200, 404));
    await expect(githubProvider.verifyAccess(opts)).rejects.toThrow(/Branch "main" not found/);
  });
});

describe('githubProvider.createBranch', () => {
  it('branches off the head sha of the source branch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'abc123' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await githubProvider.createBranch({ owner: 'acme', repo: 'widgets', auth, fromBranch: 'main', newBranchName: 'issue/PRJ-1-fix thing' });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/widgets/git/refs');
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'refs/heads/issue/PRJ-1-fix thing', sha: 'abc123' });
    expect(result.url).toBe('https://github.com/acme/widgets/tree/issue%2FPRJ-1-fix%20thing');
  });

  it('fails clearly when the source branch cannot be read or the ref cannot be created', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    await expect(githubProvider.createBranch({ owner: 'a', repo: 'b', auth, fromBranch: 'gone', newBranchName: 'x' })).rejects.toThrow(/Could not look up "gone"/);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 's' } }), { status: 200 })).mockResolvedValueOnce(new Response('{}', { status: 422 })));
    await expect(githubProvider.createBranch({ owner: 'a', repo: 'b', auth, fromBranch: 'main', newBranchName: 'exists' })).rejects.toThrow(/Could not create branch: 422/);
  });
});

describe('githubProvider.readFile', () => {
  it('decodes base64 content and URL-encodes the path and ref', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: Buffer.from('héllo').toString('base64') }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { content } = await githubProvider.readFile({ owner: 'acme', repo: 'widgets', auth, branch: 'feat/x', path: 'src/a b.ts' });

    expect(content).toBe('héllo');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.github.com/repos/acme/widgets/contents/src%2Fa%20b.ts?ref=feat%2Fx');
  });

  it('says which file and branch were missing on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    await expect(githubProvider.readFile({ owner: 'a', repo: 'b', auth, branch: 'main', path: 'nope.md' })).rejects.toThrow('"nope.md" not found on branch "main"');
  });
});

describe('githubProvider.writeFile', () => {
  const opts = { owner: 'acme', repo: 'widgets', auth, branch: 'feat', path: 'README.md', content: 'new text', commitMessage: 'Update README.md' };

  it('updates an existing file by sending its current blob sha', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'blob-sha' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await githubProvider.writeFile(opts);

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'Update README.md', content: Buffer.from('new text').toString('base64'), branch: 'feat', sha: 'blob-sha' });
  });

  it('creates a new file (no sha) only when the existence check returns 404', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockResolvedValueOnce(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await githubProvider.writeFile(opts);

    expect(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string)).not.toHaveProperty('sha');
  });

  it('refuses to guess "new file" when the existence check itself fails (403/5xx), and never writes', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(githubProvider.writeFile(opts)).rejects.toThrow(/Could not check whether "README.md" already exists: 403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockResolvedValueOnce(new Response('{}', { status: 409 })));
    await expect(githubProvider.writeFile(opts)).rejects.toThrow(/Could not write "README.md": 409/);
  });
});
