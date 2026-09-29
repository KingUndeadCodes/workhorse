import { describe, expect, it } from 'vitest';
import { createTestEngine, seedAutomationRule, seedHumanUser, seedIssue, seedWorkflow, seedWorkspace } from './helpers';

describe('EventEngine.runAutomations (via emitEvent)', () => {
  async function setup() {
    const { db } = await import('../src/db/core');
    await seedWorkspace(db);
    await seedWorkflow(db);
    const { engine, workspaceRepo, userRepo, issueRepo, automationRepo } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'reporter@example.com', 'Reporter');
    const assignee = await seedHumanUser(userRepo, 'assignee@example.com', 'Assignee');
    const issue = await seedIssue(issueRepo, { reporterId: reporter.id, statusId: 'st_todo' });
    return { engine, workspaceRepo, automationRepo, userRepo, issueRepo, reporter, assignee, issue };
  }

  it('applies a matching enabled rule\'s actions when its trigger event fires', async () => {
    const { engine, automationRepo, issueRepo, reporter, issue } = await setup();
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'transitionStatus', toStatusId: 'st_done' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    expect((await issueRepo.get(issue.id))?.statusId).toBe('st_done');
  });

  it('skips a rule whose eventFilter does not match the event type', async () => {
    const { engine, automationRepo, issueRepo, reporter, issue } = await setup();
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.labelsChanged'],
      actions: [{ type: 'transitionStatus', toStatusId: 'st_done' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    expect((await issueRepo.get(issue.id))?.statusId).toBe('st_todo');
  });

  it('skips a disabled rule', async () => {
    const { engine, automationRepo, issueRepo, reporter, issue } = await setup();
    await seedAutomationRule(automationRepo, {
      enabled: false,
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'transitionStatus', toStatusId: 'st_done' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    expect((await issueRepo.get(issue.id))?.statusId).toBe('st_todo');
  });

  it('skips a rule scoped to a different project', async () => {
    const { engine, automationRepo, issueRepo, reporter, issue } = await setup();
    await seedAutomationRule(automationRepo, {
      projectId: 'some_other_project',
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'transitionStatus', toStatusId: 'st_done' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    expect((await issueRepo.get(issue.id))?.statusId).toBe('st_todo');
  });

  it('only applies actions when every condition evaluates true', async () => {
    const { engine, automationRepo, issueRepo, reporter, issue } = await setup();
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      conditions: [{ field: 'statusId', op: '=', value: 'st_in_progress' }], // issue is st_todo, not this
      actions: [{ type: 'transitionStatus', toStatusId: 'st_done' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    expect((await issueRepo.get(issue.id))?.statusId).toBe('st_todo');
  });

  it('runs every action in a multi-action rule, in order', async () => {
    const { engine, automationRepo, issueRepo, reporter, assignee, issue } = await setup();
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [
        { type: 'transitionStatus', toStatusId: 'st_done' },
        { type: 'assignTo', userId: assignee.id },
        { type: 'addComment', body: 'auto comment' },
      ],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    const updated = await issueRepo.get(issue.id);
    expect(updated?.statusId).toBe('st_done');
    expect(updated?.assigneeIds).toContain(assignee.id);
    const comments = await issueRepo.listComments(updated!.projectId);
    expect(comments.some((c) => c.body.plainText === 'auto comment')).toBe(true);
  });

  it('never assigns an agent-kind user via assignTo — assignees are humans only', async () => {
    const { engine, automationRepo, issueRepo, userRepo, reporter, issue } = await setup();
    await userRepo.createAgentUser('u_bot', 'bot@agents.local', 'Bot', new Date().toISOString());
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'assignTo', userId: 'u_bot' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    expect((await issueRepo.get(issue.id))?.assigneeIds).not.toContain('u_bot');
  });

  it('setField records the prior value as fromValue', async () => {
    const { engine, automationRepo, issueRepo, reporter, issue } = await setup();
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'setField', fieldId: 'fld_severity', value: 'high' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    const updated = await issueRepo.get(issue.id);
    expect(updated?.fieldValues.find((f) => f.fieldId === 'fld_severity')?.value).toBe('high');
  });

  it('emits automationRule.executed after applying a rule\'s actions', async () => {
    const { engine, automationRepo, workspaceRepo, reporter, issue } = await setup();
    await seedAutomationRule(automationRepo, {
      eventFilter: ['issue.priorityChanged'],
      actions: [{ type: 'addComment', body: 'hi' }],
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
    });

    const { getAllEvents } = await import('../src/eventLog');
    const workspaceId = (await workspaceRepo.getWorkspace()).id;
    const types = getAllEvents(workspaceId).map((e) => e.payload.type);
    expect(types).toContain('automationRule.executed');
  });
});
