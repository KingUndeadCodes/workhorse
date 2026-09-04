import { describe, expect, it, vi } from 'vitest';
import { createTestEngine, seedHumanUser, seedIssue, seedWorkflow, seedWorkspace } from './helpers';

describe('EventEngine notifications (via emitEvent)', () => {
  async function setup() {
    const { db } = await import('../src/db/core');
    await seedWorkspace(db);
    await seedWorkflow(db);
    const { engine, userRepo, issueRepo, notificationRepo } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'reporter@example.com', 'Reporter');
    const assignee = await seedHumanUser(userRepo, 'assignee@example.com', 'Assignee');
    const issue = await seedIssue(issueRepo, { reporterId: reporter.id, assigneeIds: [assignee.id], statusId: 'st_todo' });
    return { engine, notificationRepo, issueRepo, reporter, assignee, issue };
  }

  it('does not double-notify when a status change also crosses into resolved', async () => {
    const { engine, notificationRepo, reporter, assignee, issue } = await setup();

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: 'st_todo', toStatusId: 'st_done' },
    });
    // Mirrors what routes/issues.ts does: a status change that crosses a done-category
    // boundary also emits issue.resolved right after the statusChanged event.
    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.resolved', issueId: issue.id, statusId: 'st_done' },
    });

    const { notifications } = await notificationRepo.listForUser(assignee.id, 20, 0);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].kind).toBe('resolved');
  });

  it('does not double-notify a mentioned user who is also the reporter', async () => {
    const { engine, notificationRepo, reporter, assignee, issue } = await setup();

    await engine.emitEvent({
      actor: { kind: 'user', userId: assignee.id },
      subject: { type: 'comment', id: 'comment_1' },
      payload: { type: 'comment.created', commentId: 'comment_1', issueId: issue.id, authorId: assignee.id, body: `@${reporter.displayName} hey` },
    });
    await engine.emitEvent({
      actor: { kind: 'user', userId: assignee.id },
      subject: { type: 'comment', id: 'comment_1' },
      payload: { type: 'comment.mentioned', commentId: 'comment_1', issueId: issue.id, authorId: assignee.id, mentionedUserId: reporter.id, body: `@${reporter.displayName} hey` },
    });

    const { notifications } = await notificationRepo.listForUser(reporter.id, 20, 0);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].kind).toBe('commented');
  });

  it('never notifies the actor about their own action', async () => {
    const { engine, notificationRepo, reporter, issue } = await setup();

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: 'st_todo', toStatusId: 'st_todo' },
    });

    const { notifications } = await notificationRepo.listForUser(reporter.id, 20, 0);
    expect(notifications).toHaveLength(0);
  });

  it('still applies and broadcasts the event even if creating a notification fails', async () => {
    const { engine, issueRepo, issue, reporter } = await setup();
    const failingEngine = engine as unknown as { notifications: { create: () => Promise<never> } };
    vi.spyOn(failingEngine.notifications, 'create').mockRejectedValueOnce(new Error('db unavailable'));

    const event = await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: 'st_todo', toStatusId: 'st_done' },
    });

    expect(event.payload.type).toBe('issue.statusChanged');
    const updated = await issueRepo.get(issue.id);
    expect(updated?.statusId).toBe('st_done');
  });
});
