import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { ActorRef, FieldValue, Issue, IssueLinkType, User } from '../domain';
import { STORY_POINT_VALUES } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { agentRepo, engine, issueRepo, userRepo, workflowRepo, workspaceRepo } from '../container';
import { persistState } from '../db/core';

export const issuesRouter = new Hono<{ Variables: AuthVariables }>();

function actorFrom(user: User): ActorRef {
  return { kind: 'user', userId: user.id };
}

/** True if any of the given ids belongs to an AI agent — assignees must be human, see `Issue.agentAssignments`. */
async function containsAgentId(userIds: string[]): Promise<boolean> {
  if (userIds.length === 0) return false;
  const agentIds = new Set((await userRepo.list()).filter((u) => u.kind === 'agent').map((u) => u.id));
  return userIds.some((id) => agentIds.has(id));
}

/** `undefined`/`null` clears the estimate and is always allowed; anything else must be one of {@link STORY_POINT_VALUES}. */
function isValidStoryPoints(value: unknown): boolean {
  return value === undefined || value === null || (STORY_POINT_VALUES as readonly number[]).includes(value as number);
}

/**
 * POST /api/issues — creates an issue.
 * Body: `{ title, issueTypeId, ...any other Issue field }`. The actor/reporter is the
 * authenticated caller, never a client-supplied id.
 * @returns `{ issue, event }`, or 400 if `title`/`issueTypeId` are missing.
 */
issuesRouter.post('/issues', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<Record<string, unknown>>();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const issueTypeId = typeof body.issueTypeId === 'string' ? body.issueTypeId : '';
  if (!title || !issueTypeId) return c.json({ error: 'title and issueTypeId are required' }, 400);
  if (await containsAgentId((body.assigneeIds as string[]) ?? [])) {
    return c.json({ error: "Agents can't be assignees — add them from the AI Agents section after creating the issue" }, 400);
  }
  if (!isValidStoryPoints(body.storyPoints)) {
    return c.json({ error: `storyPoints must be one of ${STORY_POINT_VALUES.join(', ')}` }, 400);
  }

  const project = await workspaceRepo.getProject();
  const workflow = await workflowRepo.getWorkflow();
  const now = new Date().toISOString();
  const id = `issue_${randomUUID()}`;
  const issue: Issue = {
    id,
    key: `${project.key}-${id.slice(-6)}`,
    projectId: project.id,
    issueTypeId,
    statusId: workflow.initialStatusId,
    title,
    priority: (body.priority as Issue['priority']) ?? 'medium',
    reporterId: (body.reporterId as string) ?? user.id,
    assigneeIds: (body.assigneeIds as string[]) ?? [],
    parentId: body.parentId as string | undefined,
    labelIds: (body.labelIds as string[]) ?? [],
    componentIds: (body.componentIds as string[]) ?? [],
    fixVersionIds: (body.fixVersionIds as string[]) ?? [],
    sprintId: body.sprintId as string | undefined,
    storyPoints: body.storyPoints as number | undefined,
    dueDate: body.dueDate as string | undefined,
    loggedSeconds: 0,
    fieldValues: [],
    createdAt: now,
    updatedAt: now,
  };
  const event = await engine.emitEvent({ actor: actorFrom(user), subject: { type: 'issue', id: issue.id }, payload: { type: 'issue.created', issueId: issue.id, issue } });
  return c.json({ issue: await issueRepo.get(issue.id), event }, 201);
});

/**
 * PATCH /api/issues/:id — edits built-in issue fields. Diffs the body against the current
 * issue so each kind of change emits the event it should: `statusId` -> `issue.statusChanged`,
 * `assigneeIds` -> `issue.assigneesChanged`, `sprintId` -> `issue.sprintChanged`, everything else
 * (title, description, priority, labels, components, fix versions, points, due date,
 * estimates) -> a single `issue.updated` with a `changes` map. Custom field values are
 * handled by PATCH /api/issues/:id/fields/:fieldId instead.
 */
issuesRouter.patch('/issues/:id', async (c) => {
  const id = c.req.param('id');
  const issue = await issueRepo.get(id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const actor = actorFrom(c.get('user'));

  if ('storyPoints' in body && !isValidStoryPoints(body.storyPoints)) {
    return c.json({ error: `storyPoints must be one of ${STORY_POINT_VALUES.join(', ')}` }, 400);
  }

  if ('statusId' in body && body.statusId !== issue.statusId) {
    await engine.emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.statusChanged', issueId: id, fromStatusId: issue.statusId, toStatusId: body.statusId as string } });
  }
  if ('assigneeIds' in body) {
    const toUserIds = (body.assigneeIds as string[]) ?? [];
    if (await containsAgentId(toUserIds)) {
      return c.json({ error: "Agents can't be assignees — add them from the AI Agents section instead" }, 400);
    }
    if (JSON.stringify([...toUserIds].sort()) !== JSON.stringify([...issue.assigneeIds].sort())) {
      await engine.emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.assigneesChanged', issueId: id, fromUserIds: issue.assigneeIds, toUserIds } });
      // An agent may only ever be attached on behalf of a *current* assignee — if that
      // assignee just got removed, the agent's attachment is removed with them, so the
      // "always on behalf of an assigned user" invariant holds at every point, not just at
      // attach time.
      const removedUserIds = new Set(issue.assigneeIds.filter((uid) => !toUserIds.includes(uid)));
      for (const [agentUserId, onBehalfOfUserId] of Object.entries(issue.agentAssignments ?? {})) {
        if (onBehalfOfUserId && removedUserIds.has(onBehalfOfUserId)) {
          await engine.emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.agentUnassigned', issueId: id, agentUserId } });
        }
      }
    }
  }
  if ('sprintId' in body && body.sprintId !== issue.sprintId) {
    await engine.emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.sprintChanged', issueId: id, fromSprintId: issue.sprintId, toSprintId: body.sprintId as string | undefined } });
  }

  const genericFields = [
    'title', 'description', 'priority', 'labelIds', 'componentIds', 'fixVersionIds',
    'storyPoints', 'dueDate', 'originalEstimateSeconds', 'remainingEstimateSeconds',
  ] as const;
  const changes: Record<string, unknown> = {};
  for (const field of genericFields) {
    if (!(field in body)) continue;
    const next = body[field];
    const current = (issue as unknown as Record<string, unknown>)[field];
    if (JSON.stringify(next) !== JSON.stringify(current)) changes[field] = next;
  }
  if (Object.keys(changes).length > 0) {
    await engine.emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.updated', issueId: id, changes } });
  }

  return c.json({ issue: await issueRepo.get(id) });
});

/** PATCH /api/issues/:id/fields/:fieldId — sets one custom field's value; emits `issue.fieldChanged`. */
issuesRouter.patch('/issues/:id/fields/:fieldId', async (c) => {
  const id = c.req.param('id');
  const fieldId = c.req.param('fieldId');
  const issue = await issueRepo.get(id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);

  const body = await c.req.json<{ value: FieldValue['value'] }>();
  const fromValue = issue.fieldValues.find((f) => f.fieldId === fieldId)?.value ?? null;

  const event = await engine.emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'issue', id },
    payload: { type: 'issue.fieldChanged', issueId: id, fieldId, fromValue, toValue: body.value },
  });
  return c.json({ issue: await issueRepo.get(id), event });
});

/** DELETE /api/issues/:id — deletes an issue and cascades to its comments/worklogs/attachments/links. */
issuesRouter.delete('/issues/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await issueRepo.get(id))) return c.json({ error: 'Issue not found' }, 404);

  const event = await engine.emitEvent({ actor: actorFrom(c.get('user')), subject: { type: 'issue', id }, payload: { type: 'issue.deleted', issueId: id } });
  return c.json({ event });
});

/**
 * POST /api/issues/:id/comments — adds a comment; emits `comment.created`. Body may include
 * `parentCommentId` to reply to another comment on the same issue — replies can themselves
 * be replied to, so threads can nest to any depth.
 */
issuesRouter.post('/issues/:id/comments', async (c) => {
  const id = c.req.param('id');
  if (!(await issueRepo.get(id))) return c.json({ error: 'Issue not found' }, 404);

  const user = c.get('user');
  const body = await c.req.json<{ body: string; parentCommentId?: string }>();
  if (!body.body?.trim()) return c.json({ error: 'Comment body is required' }, 400);

  let parentCommentId: string | undefined;
  if (body.parentCommentId) {
    const parent = (await issueRepo.listCommentsFor(id)).find((cm) => cm.id === body.parentCommentId);
    if (!parent) return c.json({ error: 'Parent comment not found on this issue' }, 404);
    parentCommentId = parent.id;
  }

  const commentId = `cmt_${randomUUID()}`;
  const event = await engine.emitEvent({
    actor: actorFrom(user),
    subject: { type: 'comment', id: commentId },
    payload: { type: 'comment.created', commentId, issueId: id, authorId: user.id, body: body.body.trim(), parentCommentId },
  });
  const comment = (await issueRepo.listCommentsFor(id)).find((cm) => cm.id === commentId);
  return c.json({ comment, event }, 201);
});

/** PATCH /api/issues/:issueId/comments/:commentId — edits a comment's body; emits `comment.edited`. Only the comment's own author may edit it. */
issuesRouter.patch('/issues/:issueId/comments/:commentId', async (c) => {
  const { issueId, commentId } = c.req.param();
  const comment = await issueRepo.getComment(commentId);
  if (!comment || comment.issueId !== issueId) return c.json({ error: 'Comment not found' }, 404);

  const user = c.get('user');
  if (comment.authorId !== user.id) return c.json({ error: 'Only the comment author can edit it' }, 403);

  const body = await c.req.json<{ body: string }>();
  if (!body.body?.trim()) return c.json({ error: 'Comment body is required' }, 400);

  const event = await engine.emitEvent({
    actor: actorFrom(user),
    subject: { type: 'comment', id: commentId },
    payload: { type: 'comment.edited', commentId, issueId, body: body.body.trim() },
  });
  return c.json({ comment: await issueRepo.getComment(commentId), event });
});

/** POST /api/issues/:id/links — links two issues; emits `issue.linked`. */
issuesRouter.post('/issues/:id/links', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ type: IssueLinkType; targetIssueId: string }>();
  if (!(await issueRepo.get(id)) || !(await issueRepo.get(body.targetIssueId))) return c.json({ error: 'Issue not found' }, 404);

  const linkId = `link_${randomUUID()}`;
  const event = await engine.emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'issue', id },
    payload: { type: 'issue.linked', issueId: id, linkId, linkedIssueId: body.targetIssueId, linkType: body.type },
  });
  const link = (await issueRepo.listLinksFor(id)).find((l) => l.id === linkId);
  return c.json({ link, event }, 201);
});

/** DELETE /api/issues/:issueId/links/:linkId — removes a link; emits `issue.unlinked`. */
issuesRouter.delete('/issues/:issueId/links/:linkId', async (c) => {
  const { issueId, linkId } = c.req.param();
  const event = await engine.emitEvent({ actor: actorFrom(c.get('user')), subject: { type: 'issue', id: issueId }, payload: { type: 'issue.unlinked', issueId, linkId } });
  return c.json({ event });
});

/**
 * POST /api/issues/:id/agents — attaches an AI agent to an issue on behalf of one of its
 * current human assignees. Emits `issue.agentAssigned`. Body: `{ agentUserId, onBehalfOfUserId }`.
 * 400 if `agentUserId` isn't a real agent, or `onBehalfOfUserId` isn't currently an assignee.
 */
issuesRouter.post('/issues/:id/agents', async (c) => {
  const id = c.req.param('id');
  const issue = await issueRepo.get(id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);

  const body = await c.req.json<{ agentUserId: string; onBehalfOfUserId: string }>();
  if (!(await agentRepo.get(body.agentUserId))) return c.json({ error: 'Agent not found' }, 400);
  if (!issue.assigneeIds.includes(body.onBehalfOfUserId)) {
    return c.json({ error: 'An agent can only be attached on behalf of a current assignee' }, 400);
  }

  const event = await engine.emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'issue', id },
    payload: { type: 'issue.agentAssigned', issueId: id, agentUserId: body.agentUserId, onBehalfOfUserId: body.onBehalfOfUserId },
  });
  return c.json({ issue: await issueRepo.get(id), event }, 201);
});

/** DELETE /api/issues/:id/agents/:agentUserId — detaches an agent from the issue; emits `issue.agentUnassigned`. */
issuesRouter.delete('/issues/:id/agents/:agentUserId', async (c) => {
  const { id, agentUserId } = c.req.param();
  const event = await engine.emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'issue', id },
    payload: { type: 'issue.agentUnassigned', issueId: id, agentUserId },
  });
  return c.json({ issue: await issueRepo.get(id), event });
});

/** POST /api/issues/:id/worklogs — logs time; bumps `issue.loggedSeconds`; emits `issue.worklogAdded`. */
issuesRouter.post('/issues/:id/worklogs', async (c) => {
  const id = c.req.param('id');
  if (!(await issueRepo.get(id))) return c.json({ error: 'Issue not found' }, 404);

  const user = c.get('user');
  const body = await c.req.json<{ timeSpentSeconds: number; note?: string }>();
  if (!body.timeSpentSeconds || body.timeSpentSeconds <= 0) return c.json({ error: 'timeSpentSeconds must be positive' }, 400);

  const worklogId = `wl_${randomUUID()}`;
  const event = await engine.emitEvent({
    actor: actorFrom(user),
    subject: { type: 'issue', id },
    payload: { type: 'issue.worklogAdded', issueId: id, worklogId, authorId: user.id, timeSpentSeconds: body.timeSpentSeconds, note: body.note },
  });
  const worklog = (await issueRepo.listWorklogsFor(id)).find((w) => w.id === worklogId);
  return c.json({ worklog, issue: await issueRepo.get(id), event }, 201);
});

/**
 * POST /api/issues/:id/attachments — attaches a file by URL (no upload storage in this
 * prototype — the client supplies a URL it already hosts the file at). Emits `issue.attachmentAdded`.
 */
issuesRouter.post('/issues/:id/attachments', async (c) => {
  const id = c.req.param('id');
  if (!(await issueRepo.get(id))) return c.json({ error: 'Issue not found' }, 404);

  const user = c.get('user');
  const body = await c.req.json<{ fileName: string; url: string; mimeType?: string; sizeBytes?: number }>();
  if (!body.url?.trim() || !body.fileName?.trim()) return c.json({ error: 'fileName and url are required' }, 400);

  const attachmentId = `att_${randomUUID()}`;
  const event = await engine.emitEvent({
    actor: actorFrom(user),
    subject: { type: 'issue', id },
    payload: {
      type: 'issue.attachmentAdded',
      issueId: id,
      attachmentId,
      uploadedBy: user.id,
      fileName: body.fileName.trim(),
      url: body.url.trim(),
      mimeType: body.mimeType ?? 'application/octet-stream',
      sizeBytes: body.sizeBytes ?? 0,
    },
  });
  const attachment = (await issueRepo.listAttachmentsFor(id)).find((a) => a.id === attachmentId);
  return c.json({ attachment, event }, 201);
});

/** DELETE /api/attachments/:id — removes an attachment record (not event-worthy; config-adjacent). */
issuesRouter.delete('/attachments/:id', async (c) => {
  const id = c.req.param('id');
  await issueRepo.deleteAttachment(id);
  persistState();
  return c.json({ ok: true });
});
