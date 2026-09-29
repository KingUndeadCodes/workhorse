import { describe, expect, it, vi } from 'vitest';
import { approvalPolicy, createTestEngine, fixedDecisionRuntime, seedAgent, seedHumanUser, seedIssue, seedWorkflow, seedWorkspace } from './helpers';

describe('EventEngine agents (runAgents / startAgentRun / executeAgentRun / resolveAgentRun / triggerAgentManually)', () => {
  async function setup() {
    const { db } = await import('../src/db/core');
    await seedWorkspace(db);
    await seedWorkflow(db);
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'reporter@example.com', 'Reporter');
    const issue = await seedIssue(issueRepo, { reporterId: reporter.id });
    return { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue };
  }

  it('does not react to an event on an issue it is not attached to', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([{ name: 'addComment', input: { body: 'hi' } }]));
    await seedAgent(userRepo, agentRepo, { eventFilter: ['comment.created'] });
    // Not attached via issue.agentAssignments — should stay silent even though eventFilter matches.

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.created', commentId: 'c1', issueId: issue.id, authorId: reporter.id, body: 'hello' },
    });

    const runs = await agentRunRepo.listForAgent((await agentRepo.list())[0].userId);
    expect(runs).toHaveLength(0);
    void issueRepo;
  });

  it('auto-applies a proposed action when approvalPolicy is autoApplyAll', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([{ name: 'addComment', input: { body: 'auto-applied comment' } }], 'doing it'));
    const agent = await seedAgent(userRepo, agentRepo, {
      eventFilter: ['comment.created'],
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('autoApplyAll'),
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.created', commentId: 'c1', issueId: issue.id, authorId: reporter.id, body: 'hello' },
    });

    const runs = await agentRunRepo.listForAgent(agent.userId);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('applied');
    expect(runs[0].rationale).toBe('doing it');
    const comments = await issueRepo.listComments(issue.projectId);
    expect(comments.some((c) => c.body.plainText === 'auto-applied comment')).toBe(true);
  });

  it('holds the run for approval when approvalPolicy is requireApprovalForAll, and applies nothing yet', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([{ name: 'addComment', input: { body: 'held comment' } }]));
    const agent = await seedAgent(userRepo, agentRepo, {
      eventFilter: ['comment.created'],
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('requireApprovalForAll'),
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.created', commentId: 'c1', issueId: issue.id, authorId: reporter.id, body: 'hello' },
    });

    const runs = await agentRunRepo.listForAgent(agent.userId);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('awaitingApproval');
    const comments = await issueRepo.listComments(issue.projectId);
    expect(comments.some((c) => c.body.plainText === 'held comment')).toBe(false);
  });

  it('holds only the run for approval when requireApprovalFor names an action the model actually proposed', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([{ name: 'addComment', input: { body: 'x' } }]));
    const agent = await seedAgent(userRepo, agentRepo, {
      eventFilter: ['comment.created'],
      allowedActionTypes: ['addComment', 'transitionStatus'],
      approvalPolicy: approvalPolicy('requireApprovalFor', ['transitionStatus']),
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.created', commentId: 'c1', issueId: issue.id, authorId: reporter.id, body: 'hello' },
    });

    // The model only proposed addComment, which isn't gated — so it auto-applies.
    const runs = await agentRunRepo.listForAgent(agent.userId);
    expect(runs[0].status).toBe('applied');
  });

  it('approving a held run executes its proposed actions', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([{ name: 'addComment', input: { body: 'approved comment' } }]));
    const agent = await seedAgent(userRepo, agentRepo, {
      eventFilter: ['comment.created'],
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('requireApprovalForAll'),
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());
    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.created', commentId: 'c1', issueId: issue.id, authorId: reporter.id, body: 'hello' },
    });
    const [pending] = await agentRunRepo.listForAgent(agent.userId);

    const resolved = await engine.resolveAgentRun(pending.id, 'approved', reporter.id);

    expect(resolved?.status).toBe('applied');
    const comments = await issueRepo.listComments(issue.projectId);
    expect(comments.some((c) => c.body.plainText === 'approved comment')).toBe(true);
  });

  it('rejecting a held run discards its proposed actions', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([{ name: 'addComment', input: { body: 'should never post' } }]));
    const agent = await seedAgent(userRepo, agentRepo, {
      eventFilter: ['comment.created'],
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('requireApprovalForAll'),
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());
    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.created', commentId: 'c1', issueId: issue.id, authorId: reporter.id, body: 'hello' },
    });
    const [pending] = await agentRunRepo.listForAgent(agent.userId);

    const resolved = await engine.resolveAgentRun(pending.id, 'rejected', reporter.id);

    expect(resolved?.status).toBe('rejected');
    const comments = await issueRepo.listComments(issue.projectId);
    expect(comments.some((c) => c.body.plainText === 'should never post')).toBe(false);
  });

  it('truncates proposed actions to allowedActionTypes — a disallowed tool call is dropped, not executed', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(
      fixedDecisionRuntime([
        { name: 'transitionStatus', input: { toStatusId: 'st_done' } },
        { name: 'addComment', input: { body: 'allowed' } },
      ]),
    );
    const agent = await seedAgent(userRepo, agentRepo, {
      eventFilter: ['comment.created'],
      allowedActionTypes: ['addComment'], // transitionStatus is NOT allowed
      approvalPolicy: approvalPolicy('autoApplyAll'),
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.created', commentId: 'c1', issueId: issue.id, authorId: reporter.id, body: 'hello' },
    });

    const [run] = await agentRunRepo.listForAgent(agent.userId);
    expect(run.proposedActions).toHaveLength(1);
    expect(run.proposedActions[0].type).toBe('addComment');
    expect((await issueRepo.get(issue.id))?.statusId).not.toBe('st_done');
  });

  it('truncates to budget.maxActionsPerRun', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(
      fixedDecisionRuntime([
        { name: 'addComment', input: { body: 'one' } },
        { name: 'addComment', input: { body: 'two' } },
      ]),
    );
    const agent = await seedAgent(userRepo, agentRepo, {
      eventFilter: ['comment.created'],
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('autoApplyAll'),
      budget: { maxActionsPerRun: 1 },
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.created', commentId: 'c1', issueId: issue.id, authorId: reporter.id, body: 'hello' },
    });

    const [run] = await agentRunRepo.listForAgent(agent.userId);
    expect(run.proposedActions).toHaveLength(1);
  });

  it('stops triggering once maxRunsPerHour is reached', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([{ name: 'addComment', input: { body: 'x' } }]));
    const agent = await seedAgent(userRepo, agentRepo, {
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('autoApplyAll'),
      budget: { maxRunsPerHour: 1 },
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());

    const first = await engine.triggerAgentManually(agent.userId, reporter.id, issue.id);
    const second = await engine.triggerAgentManually(agent.userId, reporter.id, issue.id);

    expect(first.run).toBeDefined();
    expect(second.run).toBeUndefined();
    expect(await agentRunRepo.listForAgent(agent.userId)).toHaveLength(1);
  });

  it('ignores its own triggered events when ignoreSelfTriggeredEvents is set', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([{ name: 'addComment', input: { body: 'reply' } }]));
    const agent = await seedAgent(userRepo, agentRepo, {
      eventFilter: ['comment.created'],
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('autoApplyAll'),
      ignoreSelfTriggeredEvents: true,
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());

    // The agent itself posts a comment — its own comment.created event must not retrigger it.
    await engine.emitEvent({
      actor: { kind: 'user', userId: agent.userId },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.created', commentId: 'c1', issueId: issue.id, authorId: agent.userId, body: 'i said something' },
    });

    expect(await agentRunRepo.listForAgent(agent.userId)).toHaveLength(0);
  });

  it('only the @-mentioned agent reacts when a comment mentions one by name', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([{ name: 'addComment', input: { body: 'reply' } }]));
    const wanted = await seedAgent(userRepo, agentRepo, {
      name: 'Wanted',
      eventFilter: ['comment.mentioned'],
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('autoApplyAll'),
    });
    const bystander = await seedAgent(userRepo, agentRepo, {
      name: 'Bystander',
      eventFilter: ['comment.mentioned'],
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('autoApplyAll'),
    });
    await issueRepo.assignAgent(issue.id, wanted.userId, new Date().toISOString());
    await issueRepo.assignAgent(issue.id, bystander.userId, new Date().toISOString());

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'comment', id: 'c1' },
      payload: { type: 'comment.mentioned', commentId: 'c1', issueId: issue.id, authorId: reporter.id, mentionedUserId: wanted.userId, body: '@Wanted help' },
    });

    expect(await agentRunRepo.listForAgent(wanted.userId)).toHaveLength(1);
    expect(await agentRunRepo.listForAgent(bystander.userId)).toHaveLength(0);
  });

  it('records the run as failed, without throwing, when the runtime itself errors', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register({
      id: 'fake',
      decide: async () => {
        throw new Error('model backend unreachable');
      },
    });
    const agent = await seedAgent(userRepo, agentRepo, { allowedActionTypes: ['addComment'] });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());

    const { run } = await engine.triggerAgentManually(agent.userId, reporter.id, issue.id);

    expect(run?.status).toBe('failed');
    expect(run?.failureReason).toMatch(/model backend unreachable/);
  });

  it('triggerAgentManually throws when the agent is not attached to the given issue', async () => {
    const { engine, userRepo, agentRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(fixedDecisionRuntime([]));
    const agent = await seedAgent(userRepo, agentRepo, {});
    // Not attached via issue.agentAssignments this time.

    await expect(engine.triggerAgentManually(agent.userId, reporter.id, issue.id)).rejects.toThrow(/Attach this agent/);
  });

  it('fails the run instead of applying further actions when the issue is deleted mid-run', async () => {
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes, reporter, issue } = await setup();
    agentRuntimes.register(
      fixedDecisionRuntime([
        { name: 'addComment', input: { body: 'first' } },
        { name: 'addComment', input: { body: 'second' } },
      ]),
    );
    const agent = await seedAgent(userRepo, agentRepo, {
      allowedActionTypes: ['addComment'],
      approvalPolicy: approvalPolicy('autoApplyAll'),
    });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());

    // Real behavior for every call except the third: triggerAgentManually's own lookup (1st)
    // and notifyRecipients' lookup while writing the first action's comment.created event
    // (2nd) both need the real issue; executeAgentRun's own refetch after applying that first
    // action (3rd) is the one this test turns into `undefined`, simulating the issue being
    // deleted by a concurrent actor between the two proposed actions.
    const realGet = issueRepo.get.bind(issueRepo);
    let getCallCount = 0;
    const getSpy = vi.spyOn(issueRepo, 'get').mockImplementation(async (id: string) => {
      getCallCount++;
      if (getCallCount === 3) return undefined;
      return realGet(id);
    });

    const { run } = await engine.triggerAgentManually(agent.userId, reporter.id, issue.id);

    expect(run?.status).toBe('failed');
    expect(run?.failureReason).toMatch(/deleted while this run was in progress/);
    // Only the first action was applied before the fetch came back empty.
    expect(run?.appliedActionIndexes).toEqual([0]);
    const comments = await issueRepo.listComments(issue.projectId);
    expect(comments.some((c) => c.body.plainText === 'first')).toBe(true);
    expect(comments.some((c) => c.body.plainText === 'second')).toBe(false);

    getSpy.mockRestore();
  });
});
