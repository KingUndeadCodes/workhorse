import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { fakeGitProvider, seedIssue, seedWorkflow, seedWorkspace } from './helpers';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-encryption-key');

type Role = 'owner' | 'member' | 'guest';

async function boot() {
  const { db } = await import('../src/db/core');
  const workspaceId = await seedWorkspace(db);
  await seedWorkflow(db);
  const container = await import('../src/container');
  container.initContainer();
  const { signToken } = await import('../src/auth/jwt');
  const { app } = await import('../src/app');

  const people = {} as Record<Role, { id: string; email: string; call: (path: string, init?: { method?: string; body?: unknown }) => Response | Promise<Response>; token: string }>;
  for (const role of ['owner', 'member', 'guest'] as const) {
    const user = await container.userRepo.createHuman(`${role}@example.com`, role, await hashPassword('correct horse'));
    await container.workspaceRepo.addMember(workspaceId, user.id, role, new Date().toISOString());
    const token = await signToken(user);
    people[role] = {
      id: user.id,
      email: user.email,
      token,
      call: (path, init = {}) =>
        app.request(`/api${path}`, {
          method: init.method ?? 'GET',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
    };
  }
  return { app, container, workspaceId, people };
}

describe('removed members lose access immediately (their JWT stays valid for days)', () => {
  it('a valid token is refused once the user is no longer a member — on reads and writes alike', async () => {
    const { people, container } = await boot();
    const issue = await seedIssue(container.issueRepo, { reporterId: people.owner.id });
    expect((await people.member.call('/auth/me')).status).toBe(200);
    expect((await people.member.call(`/issues/${issue.id}`)).status).not.toBe(401);

    expect((await people.owner.call(`/workspace-members/${people.member.id}`, { method: 'DELETE' })).status).toBe(200);

    expect((await people.member.call('/auth/me')).status).toBe(401);
    expect((await people.member.call(`/issues/${issue.id}`)).status).toBe(401);
    expect((await people.member.call('/events')).status).toBe(401);
    expect((await people.member.call(`/issues/${issue.id}/comments`, { method: 'POST', body: { body: 'still here?' } })).status).toBe(401);
    expect((await people.owner.call('/auth/me')).status).toBe(200); // everyone else is unaffected
  });

  it('cannot simply log in again to get a fresh token', async () => {
    const { app, people } = await boot();
    await people.owner.call(`/workspace-members/${people.member.id}`, { method: 'DELETE' });

    const res = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: people.member.email, password: 'correct horse' }) });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/no longer a member/);
  });

  it('login still works for current members, and still gives the same 401 for a wrong password', async () => {
    const { app, people } = await boot();
    const login = (password: string) => app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: people.member.email, password }) });
    expect((await login('correct horse')).status).toBe(200);
    expect((await login('wrong')).status).toBe(401);
  });

  it('disconnectUser closes only that user\'s sockets', async () => {
    const { disconnectUser } = await import('../src/ws');
    expect(() => disconnectUser('nobody-connected')).not.toThrow();
  });
});

describe('agents: guests cannot trigger, approve, or reject', () => {
  it.each([
    ['trigger', '/agents/u_agent/trigger', { issueId: 'x' }],
    ['approve', '/agent-runs/run_1/approve', {}],
    ['reject', '/agent-runs/run_1/reject', {}],
  ])('a guest cannot %s (approval decides whose git credential is used)', async (_name, path, body) => {
    const { people } = await boot();
    expect((await people.guest.call(path, { method: 'POST', body })).status).toBe(403);
    // A member passes the role check (and then 404s/400s on the made-up ids) — i.e. the guard is the role, nothing else.
    expect((await people.member.call(path, { method: 'POST', body })).status).not.toBe(403);
  });
});

describe('branch names are validated at the routes', () => {
  async function withLink() {
    const ctx = await boot();
    const issue = await seedIssue(ctx.container.issueRepo, { reporterId: ctx.people.owner.id });
    const createBranch = vi.fn(async () => ({ url: 'fake://b' }));
    ctx.container.gitProviders.register(fakeGitProvider({ id: 'local', createBranch }));
    await ctx.container.gitRepoLinkRepo.create({ id: 'gl', projectId: issue.projectId, provider: 'local', owner: '-', repo: 'r', defaultBranch: 'main', createdAt: new Date().toISOString(), createdBy: ctx.people.owner.id });
    return { ...ctx, issue, createBranch };
  }

  it.each(['-D', '--force', 'a..b', 'with space', '/abs'])('POST /issues/:id/branch rejects %j before any provider is called', async (name) => {
    const { people, issue, createBranch } = await withLink();
    const res = await people.member.call(`/issues/${issue.id}/branch`, { method: 'POST', body: { name } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Invalid branch name/);
    expect(createBranch).not.toHaveBeenCalled();
  });

  it('accepts a normal name', async () => {
    const { people, issue, createBranch } = await withLink();
    expect((await people.member.call(`/issues/${issue.id}/branch`, { method: 'POST', body: { name: 'issue/PRJ-1-fix' } })).status).toBe(201);
    expect(createBranch).toHaveBeenCalled();
  });

  it('linking a repo rejects a flag-shaped default branch', async () => {
    const { people } = await boot();
    const res = await people.member.call('/projects/proj_1/git-repo-link', { method: 'POST', body: { provider: 'local', owner: 'x', repo: 'r', defaultBranch: '-D' } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Invalid branch name/);
  });
});

describe('webhook routes reject dangerous targets', () => {
  const create = (call: (p: string, i?: { method?: string; body?: unknown }) => Response | Promise<Response>, targetUrl: string) =>
    call('/webhooks', { method: 'POST', body: { targetUrl, eventFilter: '*' } });

  it.each(['https://169.254.169.254/latest/meta-data/', 'https://127.0.0.1:8787/', 'https://localhost/x', 'http://hooks.example.com/x', 'https://u:p@hooks.example.com/'])(
    'POST /webhooks rejects %s',
    async (target) => {
      const { people } = await boot();
      expect((await create(people.member.call, target)).status).toBe(400);
    },
  );

  it('accepts a public https target, and PATCH re-validates a changed URL', async () => {
    const { people } = await boot();
    const res = await create(people.member.call, 'https://93.184.216.34/hook');
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    expect((await people.member.call(`/webhooks/${id}`, { method: 'PATCH', body: { targetUrl: 'https://10.0.0.1/x' } })).status).toBe(400);
    expect((await people.member.call(`/webhooks/${id}`, { method: 'PATCH', body: { targetUrl: 'https://93.184.216.35/x' } })).status).toBe(200);
    expect((await people.member.call(`/webhooks/${id}`, { method: 'PATCH', body: { enabled: false } })).status).toBe(200); // not touching the URL
  });
});

describe('a branch created by a request that then loses the "one branch per issue" race is cleaned up', () => {
  async function bootWithLink() {
    const ctx = await boot();
    const issue = await seedIssue(ctx.container.issueRepo, { reporterId: ctx.people.owner.id });
    const createBranch = vi.fn(async () => ({ url: 'fake://b' }));
    const deleteBranch = vi.fn(async () => {});
    ctx.container.gitProviders.register(fakeGitProvider({ id: 'local', createBranch, deleteBranch }));
    await ctx.container.gitRepoLinkRepo.create({ id: 'gl', projectId: issue.projectId, provider: 'local', owner: '-', repo: 'r', defaultBranch: 'main', createdAt: new Date().toISOString(), createdBy: ctx.people.owner.id });
    return { ...ctx, issue, createBranch, deleteBranch };
  }

  it('deletes the ref it just created and still answers 400 "already has a branch"', async () => {
    const { people, container, issue, createBranch, deleteBranch } = await bootWithLink();
    // The winner of the race: a branch record already exists, but this request's fast-path check misses it.
    await container.issueRepo.insertBranch({ id: 'branch_winner', issueId: issue.id, gitRepoLinkId: 'gl', name: 'winner', url: 'x', createdAt: new Date().toISOString(), createdBy: people.owner.id });
    vi.spyOn(container.issueRepo, 'getBranchFor').mockResolvedValueOnce(undefined);

    const res = await people.member.call(`/issues/${issue.id}/branch`, { method: 'POST', body: { name: 'issue/loser' } });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/already has a branch/);
    expect(createBranch).toHaveBeenCalledTimes(1);
    expect(deleteBranch).toHaveBeenCalledWith(expect.objectContaining({ branchName: 'issue/loser' }));
  });

  it('a failing cleanup does not mask the 400', async () => {
    const { people, container, issue, deleteBranch } = await bootWithLink();
    deleteBranch.mockRejectedValueOnce(new Error('host down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await container.issueRepo.insertBranch({ id: 'branch_winner', issueId: issue.id, gitRepoLinkId: 'gl', name: 'winner', url: 'x', createdAt: new Date().toISOString(), createdBy: people.owner.id });
    vi.spyOn(container.issueRepo, 'getBranchFor').mockResolvedValueOnce(undefined);

    expect((await people.member.call(`/issues/${issue.id}/branch`, { method: 'POST', body: { name: 'issue/loser' } })).status).toBe(400);
    consoleError.mockRestore();
  });
});
