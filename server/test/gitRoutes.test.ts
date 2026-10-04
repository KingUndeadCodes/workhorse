import { describe, expect, it, vi } from 'vitest';
import type { GitAuth, GitRepoLink } from '../src/domain';
import { fakeGitProvider, seedIssue, seedWorkflow, seedWorkspace } from './helpers';

// Every secret the routes touch comes from env, so nothing here reads or writes server/data.
vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-encryption-key');
vi.stubEnv('OAUTH_STATE_SECRET', 'test-oauth-state-secret');
vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'cid');
vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'csecret');
vi.stubEnv('PUBLIC_URL', 'http://localhost:8787');

const pat: GitAuth = { kind: 'token', token: 'ghp_mine' };

async function boot() {
  const { db } = await import('../src/db/core');
  const workspaceId = await seedWorkspace(db);
  await seedWorkflow(db);
  const container = await import('../src/container');
  container.initContainer();
  const { signToken } = await import('../src/auth/jwt');
  const { app } = await import('../src/app');

  const user = await container.userRepo.createHuman('member@example.com', 'Tester', 'hash');
  await container.workspaceRepo.addMember(workspaceId, user.id, 'member', new Date().toISOString());
  const guest = await container.userRepo.createHuman('guest@example.com', 'Guest', 'hash');
  await container.workspaceRepo.addMember(workspaceId, guest.id, 'guest', new Date().toISOString());

  const caller = (token: string) => (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  const call = caller(await signToken(user));
  const guestCall = caller(await signToken(guest));
  const connect = (auth: GitAuth = pat, userId = user.id, provider = 'github') =>
    container.userGitConnectionRepo.upsert({ userId, provider, auth, accountLogin: 'octocat', createdAt: new Date().toISOString() });
  return { app, call, guestCall, connect, user, container, workspaceId, db };
}

describe('GET /api/git-connections', () => {
  it('lists only the caller\'s connections, without secrets, and reports whether OAuth is configured', async () => {
    const { call, connect, container } = await boot();
    const other = await container.userRepo.createHuman('other@example.com', 'Other', 'hash');
    await connect();
    await connect({ kind: 'token', token: 'theirs' }, other.id);

    const body = (await (await call('/git-connections')).json()) as { connections: Record<string, unknown>[]; githubOAuth: boolean };
    expect(body.githubOAuth).toBe(true);
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]).toMatchObject({ provider: 'github', accountLogin: 'octocat', authKind: 'token' });
    expect(JSON.stringify(body)).not.toContain('ghp_mine');
    expect(body.connections[0]).not.toHaveProperty('auth');
  });

  it('reports OAuth as unavailable when any GITHUB_OAUTH_* / PUBLIC_URL var is missing', async () => {
    const { call } = await boot();
    vi.stubEnv('PUBLIC_URL', '');
    try {
      expect(((await (await call('/git-connections')).json()) as { githubOAuth: boolean }).githubOAuth).toBe(false);
    } finally {
      vi.stubEnv('PUBLIC_URL', 'http://localhost:8787');
    }
  });

  it('requires authentication', async () => {
    const { app } = await boot();
    expect((await app.request('/api/git-connections')).status).toBe(401);
  });
});

describe('PUT /api/git-connections/:provider (paste a token)', () => {
  it('verifies the token via the provider, then stores it for the caller', async () => {
    const { call, container, user } = await boot();
    const identify = vi.fn(async () => ({ login: 'octocat' }));
    container.gitProviders.register(fakeGitProvider({ id: 'github', identify }));

    const res = await call('/git-connections/github', { method: 'PUT', body: { token: '  ghp_new  ' } });

    expect(res.status).toBe(200);
    expect(identify).toHaveBeenCalledWith({ kind: 'token', token: 'ghp_new' });
    expect(await res.json()).toMatchObject({ provider: 'github', accountLogin: 'octocat', authKind: 'token' });
    expect((await container.userGitConnectionRepo.get(user.id, 'github'))?.auth).toEqual({ kind: 'token', token: 'ghp_new' });
  });

  it('rejects a token the provider refuses, storing nothing', async () => {
    const { call, container, user } = await boot();
    container.gitProviders.register(
      fakeGitProvider({
        id: 'github',
        identify: async () => {
          throw new Error('GitHub rejected this token');
        },
      }),
    );

    const res = await call('/git-connections/github', { method: 'PUT', body: { token: 'bad' } });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/rejected this token/);
    expect(await container.userGitConnectionRepo.get(user.id, 'github')).toBeUndefined();
  });

  it('rejects an empty token, a provider with no accounts (local), and guests', async () => {
    const { call, guestCall } = await boot();
    expect((await call('/git-connections/github', { method: 'PUT', body: { token: '  ' } })).status).toBe(400);
    expect((await call('/git-connections/local', { method: 'PUT', body: { token: 'x' } })).status).toBe(400);
    expect((await guestCall('/git-connections/github', { method: 'PUT', body: { token: 'x' } })).status).toBe(403);
  });
});

describe('DELETE /api/git-connections/:provider', () => {
  it('removes only the caller\'s own connection', async () => {
    const { call, connect, container, user } = await boot();
    const other = await container.userRepo.createHuman('other@example.com', 'Other', 'hash');
    await connect();
    await connect(pat, other.id);

    expect((await call('/git-connections/github', { method: 'DELETE' })).status).toBe(200);

    expect(await container.userGitConnectionRepo.get(user.id, 'github')).toBeUndefined();
    expect(await container.userGitConnectionRepo.get(other.id, 'github')).toBeDefined();
  });
});

describe('GET /api/git-connections/:provider/repos (repo picker source)', () => {
  const repos = [{ owner: 'acme', repo: 'widgets', defaultBranch: 'trunk', private: true }];

  it('lists repos using the caller\'s own credential', async () => {
    const { call, connect, container } = await boot();
    const listRepos = vi.fn(async () => repos);
    container.gitProviders.register(fakeGitProvider({ id: 'github', listRepos }));
    await connect({ kind: 'oauth', accessToken: 'gho_mine' });

    const res = await call('/git-connections/github/repos');

    expect(await res.json()).toEqual(repos);
    expect(listRepos).toHaveBeenCalledWith({ kind: 'oauth', accessToken: 'gho_mine' });
  });

  it('400s without a connection, 400s for a provider that cannot list, 404s for an unknown one, 502s when the host fails', async () => {
    const { call, connect, container } = await boot();
    container.gitProviders.register(fakeGitProvider({ id: 'github', listRepos: async () => { throw new Error('boom'); } }));
    expect((await call('/git-connections/github/repos')).status).toBe(400);
    expect((await call('/git-connections/local/repos')).status).toBe(400);
    expect((await call('/git-connections/nope/repos')).status).toBe(404);

    await connect();
    const res = await call('/git-connections/github/repos');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('boom');
  });
});

describe('GitHub OAuth start + callback', () => {
  const returnTo = 'http://localhost:5173/';

  it('start returns a GitHub authorize URL carrying a signed state for the caller', async () => {
    const { call, user } = await boot();

    const { url } = (await (await call('/git-connections/github/oauth/start', { method: 'POST', body: { returnTo } })).json()) as { url: string };

    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:8787/api/git-connections/github/oauth/callback');
    const { verifyState } = await import('../src/services/githubOAuth');
    expect(verifyState(u.searchParams.get('state')!)).toMatchObject({ userId: user.id, returnTo });
  });

  it('start rejects a non-http(s) returnTo, guests, and an unconfigured server', async () => {
    const { call, guestCall } = await boot();
    expect((await call('/git-connections/github/oauth/start', { method: 'POST', body: { returnTo: 'javascript:alert(1)' } })).status).toBe(400);
    expect((await call('/git-connections/github/oauth/start', { method: 'POST', body: { returnTo: 'not a url' } })).status).toBe(400);

    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', '');
    try {
      expect((await call('/git-connections/github/oauth/start', { method: 'POST', body: { returnTo } })).status).toBe(400);
    } finally {
      vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'cid');
    }
    expect((await guestCall('/git-connections/github/oauth/start', { method: 'POST', body: { returnTo } })).status).toBe(403);
  });

  async function callback(app: Awaited<ReturnType<typeof boot>>['app'], query: Record<string, string>) {
    return app.request(`/api/git-connections/github/oauth/callback?${new URLSearchParams(query)}`, { redirect: 'manual' });
  }

  it('callback (no bearer token — authorized by state alone) exchanges the code and saves the connection for the state\'s user', async () => {
    const { app, container, user } = await boot();
    container.gitProviders.register(fakeGitProvider({ id: 'github', identify: async () => ({ login: 'octocat' }) }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'gho_fresh' }), { status: 200 })));
    const { signState } = await import('../src/services/githubOAuth');

    const res = await callback(app, { code: 'abc', state: signState({ userId: user.id, returnTo }) });

    vi.unstubAllGlobals();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${returnTo}?gitConnect=ok`);
    expect(await container.userGitConnectionRepo.get(user.id, 'github')).toMatchObject({ auth: { kind: 'oauth', accessToken: 'gho_fresh' }, accountLogin: 'octocat' });
  });

  it('callback rejects a missing, forged, or expired state without redirecting', async () => {
    const { app, user } = await boot();
    const { signState } = await import('../src/services/githubOAuth');
    expect((await callback(app, { code: 'abc' })).status).toBe(400);
    expect((await callback(app, { code: 'abc', state: 'forged.state' })).status).toBe(400);

    vi.useFakeTimers();
    const state = signState({ userId: user.id, returnTo });
    vi.advanceTimersByTime(11 * 60 * 1000);
    try {
      expect((await callback(app, { code: 'abc', state })).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('callback redirects back with an error when the user denies access or the exchange fails, saving nothing', async () => {
    const { app, container, user } = await boot();
    const { signState } = await import('../src/services/githubOAuth');
    const state = signState({ userId: user.id, returnTo });

    const denied = await callback(app, { state, error_description: 'The user has denied your application access.' });
    expect(new URL(denied.headers.get('location')!).searchParams.get('message')).toMatch(/denied/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }), { status: 200 })));
    const failed = await callback(app, { code: 'stale', state });
    vi.unstubAllGlobals();
    const location = new URL(failed.headers.get('location')!);
    expect(location.searchParams.get('gitConnect')).toBe('error');
    expect(location.searchParams.get('message')).toMatch(/incorrect or expired/);
    expect(await container.userGitConnectionRepo.get(user.id, 'github')).toBeUndefined();
  });
});

describe('POST /api/projects/:id/git-repo-link', () => {
  const body = { provider: 'fake', owner: 'acme', repo: 'widgets', defaultBranch: 'main' };

  it('verifies with the caller\'s own connection and stores a link with no credential', async () => {
    const { call, connect, container, user } = await boot();
    const verifyAccess = vi.fn(async () => {});
    container.gitProviders.register(fakeGitProvider({ id: 'fake', verifyAccess }));
    await connect({ kind: 'oauth', accessToken: 'gho_mine' }, user.id, 'fake');

    const res = await call('/projects/proj_1/git-repo-link', { method: 'POST', body });

    expect(res.status).toBe(201);
    expect(verifyAccess).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', branch: 'main', auth: { kind: 'oauth', accessToken: 'gho_mine' } });
    const link = (await res.json()) as GitRepoLink;
    expect(link).toMatchObject({ projectId: 'proj_1', provider: 'fake', owner: 'acme', repo: 'widgets', createdBy: user.id });
    expect(JSON.stringify(link)).not.toContain('gho_mine');
    expect(await container.gitRepoLinkRepo.getForProject('proj_1')).toEqual(link);
  });

  it('400s with a "connect an account" message, storing nothing, when the caller has no connection', async () => {
    const { call, container } = await boot();
    container.gitProviders.register(fakeGitProvider({ id: 'fake' }));

    const res = await call('/projects/proj_1/git-repo-link', { method: 'POST', body });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/No fake account is connected/);
    expect(await container.gitRepoLinkRepo.getForProject('proj_1')).toBeUndefined();
  });

  it('surfaces the provider\'s own reason when access verification fails, storing nothing', async () => {
    const { call, connect, container, user } = await boot();
    container.gitProviders.register(fakeGitProvider({ id: 'fake', verifyAccess: async () => { throw new Error('Repository "acme/widgets" not found'); } }));
    await connect(pat, user.id, 'fake');

    const res = await call('/projects/proj_1/git-repo-link', { method: 'POST', body });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/not found/);
    expect(await container.gitRepoLinkRepo.getForProject('proj_1')).toBeUndefined();
  });

  it('needs no connection for local, requires provider/owner/repo, and rejects guests', async () => {
    const { call, guestCall, container } = await boot();
    container.gitProviders.register(fakeGitProvider({ id: 'local' }));
    expect((await call('/projects/proj_1/git-repo-link', { method: 'POST', body: { ...body, provider: 'local' } })).status).toBe(201);
    expect((await call('/projects/proj_1/git-repo-link', { method: 'POST', body: { provider: 'local', owner: '', repo: 'x' } })).status).toBe(400);
    expect((await guestCall('/projects/proj_1/git-repo-link', { method: 'POST', body })).status).toBe(403);
  });
});

describe('POST /api/issues/:id/branch', () => {
  async function bootWithIssue() {
    const ctx = await boot();
    const issue = await seedIssue(ctx.container.issueRepo, { reporterId: ctx.user.id });
    const createBranch = vi.fn(async ({ newBranchName }: { newBranchName: string }) => ({ url: `fake://branch/${newBranchName}` }));
    ctx.container.gitProviders.register(fakeGitProvider({ id: 'fake', createBranch }));
    await ctx.container.gitRepoLinkRepo.create({ id: 'gitlink_1', projectId: issue.projectId, provider: 'fake', owner: 'acme', repo: 'widgets', defaultBranch: 'main', createdAt: new Date().toISOString(), createdBy: 'someone_else' });
    return { ...ctx, issue, createBranch };
  }

  it('creates the branch with the clicking user\'s credential, not the link creator\'s', async () => {
    const { call, connect, user, issue, createBranch } = await bootWithIssue();
    await connect({ kind: 'oauth', accessToken: 'gho_clicker' }, user.id, 'fake');

    const res = await call(`/issues/${issue.id}/branch`, { method: 'POST', body: {} });

    expect(res.status).toBe(201);
    expect(createBranch).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: 'oauth', accessToken: 'gho_clicker' }, fromBranch: 'main' }));
  });

  it('400s with a "connect an account" message when neither the clicker nor the link creator has a connection', async () => {
    const { call, issue, createBranch } = await bootWithIssue();

    const res = await call(`/issues/${issue.id}/branch`, { method: 'POST', body: {} });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/No fake account is connected/);
    expect(createBranch).not.toHaveBeenCalled();
  });
});
