import { describe, expect, it } from 'vitest';
import type { ActorRef, EventEnvelope, EventPayload, Issue, User } from '../src/domain';
import { computeNotificationContext } from '../src/services/notificationContext';
import type { WorkflowRepository } from '../src/repositories/WorkflowRepository';

const workflow = {
  getWorkflow: async () => ({
    statuses: [
      { id: 'st_todo', name: 'To Do' },
      { id: 'st_doing', name: 'In Progress' },
      { id: 'st_done', name: 'Done' },
    ],
  }),
} as unknown as WorkflowRepository;

const issue = { id: 'i1', key: 'PRJ-12', title: 'Write onboarding emails', projectId: 'p1' } as Issue;
const user = { id: 'u1', displayName: 'Dana', kind: 'human' } as User;

const event = (payload: EventPayload, actor: ActorRef = { kind: 'user', userId: 'u1' }) => ({ payload, actor }) as unknown as EventEnvelope;

describe('computeNotificationContext', () => {
  it('names who did it by id and kind, so the panel can render their avatar', async () => {
    const ctx = await computeNotificationContext(event({ type: 'issue.assigneesChanged', issueId: 'i1', fromUserIds: [], toUserIds: ['u2'] }), issue, user, workflow);
    expect(ctx).toMatchObject({ issueKey: 'PRJ-12', issueTitle: 'Write onboarding emails', projectId: 'p1', actorName: 'Dana', actorId: 'u1', actorKind: 'user' });
  });

  it('reports an automation as the actor, with no user behind it', async () => {
    const ctx = await computeNotificationContext(
      event({ type: 'issue.assigneesChanged', issueId: 'i1', fromUserIds: [], toUserIds: ['u2'] }, { kind: 'automation', ruleId: 'r1' }),
      issue,
      undefined,
      workflow,
    );
    expect(ctx.actorKind).toBe('automation');
    expect(ctx.actorId).toBeUndefined();
    expect(ctx.actorName).toBeUndefined();
  });

  it('gives both ends of a status change, and only the destination for a resolve', async () => {
    const moved = await computeNotificationContext(event({ type: 'issue.statusChanged', issueId: 'i1', fromStatusId: 'st_todo', toStatusId: 'st_doing' }), issue, user, workflow);
    expect(moved).toMatchObject({ fromStatusName: 'To Do', statusName: 'In Progress' });

    const resolved = await computeNotificationContext(event({ type: 'issue.resolved', issueId: 'i1', statusId: 'st_done' }), issue, user, workflow);
    expect(resolved.statusName).toBe('Done');
    expect(resolved.fromStatusName).toBeUndefined();
  });

  it('truncates a long comment to a preview and leaves a short one alone', async () => {
    const comment = (body: string) => event({ type: 'comment.created', commentId: 'c1', issueId: 'i1', authorId: 'u1', body });
    const long = await computeNotificationContext(comment('x'.repeat(500)), issue, user, workflow);
    expect(long.commentPreview).toHaveLength(201); // 200 characters plus the ellipsis
    expect(long.commentPreview?.endsWith('…')).toBe(true);
    expect((await computeNotificationContext(comment('short'), issue, user, workflow)).commentPreview).toBe('short');
  });
});
