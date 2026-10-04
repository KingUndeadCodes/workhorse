import { describe, expect, it, vi } from 'vitest';
import type { GitRepoLink } from '../src/domain';
import { UserGitConnectionRepository } from '../src/repositories/UserGitConnectionRepository';
import { createTestEngine, fakeGitProvider, seedAutomationRule, seedHumanUser, seedIssue, seedWorkflow, seedWorkspace } from './helpers';

describe('EventEngine readRepoFile/writeRepoFile actions', () => {
  async function setup() {
    const { db } = await import('../src/db/core');
    await seedWorkspace(db);
    await seedWorkflow(db);
    const { engine, workspaceRepo, userRepo, issueRepo, automationRepo, gitRepoLinkRepo, userGitConnectionRepo, gitProviders } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'reporter@example.com', 'Reporter');
    const issue = await seedIssue(issueRepo, { reporterId: reporter.id });
    return { engine, workspaceRepo, automationRepo, issueRepo, gitRepoLinkRepo, userGitConnectionRepo, gitProviders, reporter, issue };
  }

  /** Links the project's repo as 'u_test' and — unless told otherwise — gives that creator a connection, the last-resort credential. */
  async function linkRepo(gitRepoLinkRepo: Awaited<ReturnType<typeof setup>>['gitRepoLinkRepo'], projectId: string, creatorToken: string | null = 'creator-token'): Promise<GitRepoLink> {
    if (creatorToken) {
      const { db } = await import('../src/db/core');
      await new UserGitConnectionRepository(db).upsert({ userId: 'u_test', provider: 'fake', auth: { kind: 'token', token: creatorToken }, createdAt: new Date().toISOString() });
    }
    return gitRepoLinkRepo.create({
      id: 'gitlink_test',
      projectId,
      provider: 'fake',
      owner: 'acme',
      repo: 'widgets',
      defaultBranch: 'main',
      createdAt: new Date().toISOString(),
      createdBy: 'u_test',
    });
  }

  it('surfaces a clear error when the project has no linked repo, without projecting a repoFileRead event', async () => {
    const { engine, workspaceRepo, automationRepo, reporter, issue } = await setup();
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'readRepoFile', path: 'README.md' }],
    });

    // applyAction throws 'This project has no linked git repository' — runAutomations doesn't
    // catch per-action, so the triggering event's own emitEvent call rejects.
    await expect(
      engine.emitEvent({
        actor: { kind: 'user', userId: reporter.id },
        subject: { type: 'issue', id: issue.id },
        payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
      }),
    ).rejects.toThrow(/no linked git repository/);

    const { getAllEvents } = await import('../src/eventLog');
    const workspaceId = (await workspaceRepo.getWorkspace()).id;
    expect(getAllEvents(workspaceId).some((e) => e.payload.type === 'issue.repoFileRead')).toBe(false);
  });

  it('readRepoFile records the file content via issue.repoFileRead', async () => {
    const { engine, workspaceRepo, automationRepo, gitRepoLinkRepo, gitProviders, reporter, issue } = await setup();
    gitProviders.register(fakeGitProvider({ id: 'fake', readFile: async () => ({ content: 'hello world' }) }));
    await linkRepo(gitRepoLinkRepo, issue.projectId);
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'readRepoFile', path: 'README.md' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    const { getAllEvents } = await import('../src/eventLog');
    const workspaceId = (await workspaceRepo.getWorkspace()).id;
    const readEvent = getAllEvents(workspaceId).find((e) => e.payload.type === 'issue.repoFileRead');
    expect(readEvent?.payload).toMatchObject({ path: 'README.md', content: 'hello world' });
  });

  it('writeRepoFile creates the branch first when it does not exist yet, then writes', async () => {
    const { engine, automationRepo, gitRepoLinkRepo, gitProviders, reporter, issue } = await setup();
    const createBranch = vi.fn(async ({ newBranchName }: { newBranchName: string }) => ({ url: `fake://branch/${newBranchName}` }));
    const writeFile = vi.fn(async ({ branch, path }: { branch: string; path: string }) => ({ url: `fake://file/${branch}/${path}` }));
    gitProviders.register(
      fakeGitProvider({
        id: 'fake',
        verifyAccess: async () => {
          throw new Error('branch does not exist yet');
        },
        createBranch,
        writeFile,
      }),
    );
    await linkRepo(gitRepoLinkRepo, issue.projectId);
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'writeRepoFile', path: 'src/x.ts', content: 'export {}', branchName: 'agent/fix-1' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    expect(createBranch).toHaveBeenCalledWith(expect.objectContaining({ fromBranch: 'main', newBranchName: 'agent/fix-1' }));
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ branch: 'agent/fix-1', path: 'src/x.ts', content: 'export {}' }));
  });

  it('writeRepoFile skips branch creation when the branch already exists', async () => {
    const { engine, automationRepo, gitRepoLinkRepo, gitProviders, reporter, issue } = await setup();
    const createBranch = vi.fn(async ({ newBranchName }: { newBranchName: string }) => ({ url: `fake://branch/${newBranchName}` }));
    gitProviders.register(fakeGitProvider({ id: 'fake', verifyAccess: async () => {}, createBranch }));
    await linkRepo(gitRepoLinkRepo, issue.projectId);
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'writeRepoFile', path: 'src/x.ts', content: 'export {}', branchName: 'existing-branch' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    expect(createBranch).not.toHaveBeenCalled();
  });

  it('defaults the commit message when none is given', async () => {
    const { engine, automationRepo, gitRepoLinkRepo, gitProviders, reporter, issue } = await setup();
    const writeFile = vi.fn(async ({ branch, path }: { branch: string; path: string }) => ({ url: `fake://file/${branch}/${path}` }));
    gitProviders.register(fakeGitProvider({ id: 'fake', verifyAccess: async () => {}, writeFile }));
    await linkRepo(gitRepoLinkRepo, issue.projectId);
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'writeRepoFile', path: 'src/x.ts', content: 'export {}', branchName: 'b' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ commitMessage: 'Update src/x.ts' }));
  });

  const fireReadRule = async (ctx: Awaited<ReturnType<typeof setup>>) => {
    await seedAutomationRule(ctx.automationRepo, { eventFilter: ['issue.priorityChanged'], actions: [{ type: 'readRepoFile', path: 'README.md' }] });
    return ctx.engine.emitEvent({
      actor: { kind: 'user', userId: ctx.reporter.id },
      subject: { type: 'issue', id: ctx.issue.id },
      payload: { type: 'issue.priorityChanged', issueId: ctx.issue.id, fromPriority: 'medium', toPriority: 'high' },
    });
  };

  it("acts with the triggering person's own credential, not the link creator's", async () => {
    const ctx = await setup();
    const readFile = vi.fn(async () => ({ content: 'x' }));
    ctx.gitProviders.register(fakeGitProvider({ id: 'fake', readFile }));
    await linkRepo(ctx.gitRepoLinkRepo, ctx.issue.projectId);
    await ctx.userGitConnectionRepo.upsert({ userId: ctx.reporter.id, provider: 'fake', auth: { kind: 'oauth', accessToken: 'reporter-token' }, createdAt: new Date().toISOString() });

    await fireReadRule(ctx);

    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: 'oauth', accessToken: 'reporter-token' } }));
  });

  it('falls back to the link creator when the triggering person has not connected an account', async () => {
    const ctx = await setup();
    const readFile = vi.fn(async () => ({ content: 'x' }));
    ctx.gitProviders.register(fakeGitProvider({ id: 'fake', readFile }));
    await linkRepo(ctx.gitRepoLinkRepo, ctx.issue.projectId);

    await fireReadRule(ctx);

    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: 'token', token: 'creator-token' } }));
  });

  it('fails with a clear error when nobody involved has connected an account', async () => {
    const ctx = await setup();
    ctx.gitProviders.register(fakeGitProvider({ id: 'fake' }));
    await linkRepo(ctx.gitRepoLinkRepo, ctx.issue.projectId, null);

    await expect(fireReadRule(ctx)).rejects.toThrow(/No fake account is connected/);
  });
});
