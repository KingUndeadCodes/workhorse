import { describe, expect, it, vi } from 'vitest';
import type { GitRepoLink } from '../src/domain';
import { UserGitConnectionRepository } from '../src/repositories/UserGitConnectionRepository';
import { approvalPolicy, createTestEngine, fakeGitProvider, fixedDecisionRuntime, seedAgent, seedAutomationRule, seedHumanUser, seedIssue, seedWorkflow, seedWorkspace } from './helpers';

describe('EventEngine readRepoFile/writeRepoFile actions', () => {
  async function setup() {
    const { db } = await import('../src/db/core');
    await seedWorkspace(db);
    await seedWorkflow(db);
    const { engine, workspaceRepo, userRepo, issueRepo, automationRepo, agentRepo, agentRunRepo, agentRuntimes, gitRepoLinkRepo, userGitConnectionRepo, gitProviders } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'reporter@example.com', 'Reporter');
    const issue = await seedIssue(issueRepo, { reporterId: reporter.id });
    return { engine, workspaceRepo, userRepo, automationRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, gitRepoLinkRepo, userGitConnectionRepo, gitProviders, reporter, issue };
  }

  /**
   * Links the project's repo as 'u_test'. `connectUserId`, if given, gets a connection for it — who has
   * connected is the whole point of these tests, so nothing is connected unless a test says so.
   */
  async function linkRepo(gitRepoLinkRepo: Awaited<ReturnType<typeof setup>>['gitRepoLinkRepo'], projectId: string, connectUserId?: string): Promise<GitRepoLink> {
    if (connectUserId) {
      const { db } = await import('../src/db/core');
      await new UserGitConnectionRepository(db).upsert({ userId: connectUserId, provider: 'fake', auth: { kind: 'token', token: 'irrelevant-for-a-fake-provider' }, createdAt: new Date().toISOString() });
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
    await linkRepo(gitRepoLinkRepo, issue.projectId, reporter.id);
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
    await linkRepo(gitRepoLinkRepo, issue.projectId, reporter.id);
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
    await linkRepo(gitRepoLinkRepo, issue.projectId, reporter.id);
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
    await linkRepo(gitRepoLinkRepo, issue.projectId, reporter.id);
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

  it("acts with the triggering person's own credential", async () => {
    const ctx = await setup();
    const readFile = vi.fn(async () => ({ content: 'x' }));
    ctx.gitProviders.register(fakeGitProvider({ id: 'fake', readFile }));
    await linkRepo(ctx.gitRepoLinkRepo, ctx.issue.projectId);
    await ctx.userGitConnectionRepo.upsert({ userId: ctx.reporter.id, provider: 'fake', auth: { kind: 'oauth', accessToken: 'reporter-token' }, createdAt: new Date().toISOString() });

    await fireReadRule(ctx);

    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: 'oauth', accessToken: 'reporter-token' } }));
  });

  it("never borrows the link creator's credential — someone with no connection of their own cannot act with it", async () => {
    const ctx = await setup();
    const readFile = vi.fn(async () => ({ content: 'x' }));
    ctx.gitProviders.register(fakeGitProvider({ id: 'fake', readFile }));
    await linkRepo(ctx.gitRepoLinkRepo, ctx.issue.projectId, 'u_test'); // the creator HAS connected; the reporter has not

    await expect(fireReadRule(ctx)).rejects.toThrow(/No fake account is connected/);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('fails with a clear error when nobody involved has connected an account', async () => {
    const ctx = await setup();
    ctx.gitProviders.register(fakeGitProvider({ id: 'fake' }));
    await linkRepo(ctx.gitRepoLinkRepo, ctx.issue.projectId);

    await expect(fireReadRule(ctx)).rejects.toThrow(/No fake account is connected/);
  });

  describe('when an agent acts (commits by proxy — an agent has no git identity of its own)', () => {
    async function agentSetup() {
      const ctx = await setup();
      const readFile = vi.fn(async () => ({ content: 'x' }));
      ctx.gitProviders.register(fakeGitProvider({ id: 'fake', readFile }));
      ctx.agentRuntimes.register(fixedDecisionRuntime([{ name: 'readRepoFile', input: { path: 'README.md' } }]));
      await linkRepo(ctx.gitRepoLinkRepo, ctx.issue.projectId);
      const agent = await seedAgent(ctx.userRepo, ctx.agentRepo, { eventFilter: ['comment.created'], allowedActionTypes: ['readRepoFile'], approvalPolicy: approvalPolicy('requireApprovalForAll') });
      await ctx.issueRepo.assignAgent(ctx.issue.id, agent.userId, new Date().toISOString());
      const approver = await seedHumanUser(ctx.userRepo, 'approver@example.com', 'Approver');
      const connect = (userId: string, token: string) =>
        ctx.userGitConnectionRepo.upsert({ userId, provider: 'fake', auth: { kind: 'token', token }, createdAt: new Date().toISOString() });

      // The asker's comment makes the agent propose a read, then holds the run for approval.
      const askAndHold = async () => {
        await ctx.engine.emitEvent({
          actor: { kind: 'user', userId: ctx.reporter.id },
          subject: { type: 'comment', id: 'c1' },
          payload: { type: 'comment.created', commentId: 'c1', issueId: ctx.issue.id, authorId: ctx.reporter.id, body: 'please read the readme' },
        });
        const [run] = await ctx.agentRunRepo.listForAgent(agent.userId);
        expect(run.status).toBe('awaitingApproval');
        return run;
      };
      return { ...ctx, agent, approver, readFile, connect, askAndHold };
    }

    it("uses the approver's credential first", async () => {
      const { engine, approver, reporter, readFile, connect, askAndHold } = await agentSetup();
      await connect('u_test', 'creator-token');
      await connect(reporter.id, 'asker-token');
      await connect(approver.id, 'approver-token');
      const run = await askAndHold();

      await engine.resolveAgentRun(run.id, 'approved', approver.id);

      expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: 'token', token: 'approver-token' } }));
    });

    it('falls back to whoever triggered the run when the approver has not connected an account', async () => {
      const { engine, approver, reporter, readFile, connect, askAndHold } = await agentSetup();
      await connect('u_test', 'creator-token');
      await connect(reporter.id, 'asker-token');
      const run = await askAndHold();

      await engine.resolveAgentRun(run.id, 'approved', approver.id);

      expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: 'token', token: 'asker-token' } }));
    });

    it("fails the run rather than using the link creator's credential when neither approver nor asker has connected", async () => {
      const { engine, approver, agent, agentRunRepo, readFile, connect, askAndHold } = await agentSetup();
      await connect('u_test', 'creator-token'); // exists, but must not be used
      const run = await askAndHold();

      const resolved = await engine.resolveAgentRun(run.id, 'approved', approver.id);

      expect(resolved?.status).toBe('failed');
      expect(resolved?.failureReason).toMatch(/No fake account is connected/);
      expect(readFile).not.toHaveBeenCalled();
      expect((await agentRunRepo.listForAgent(agent.userId))[0].status).toBe('failed');
    });
  });
});
