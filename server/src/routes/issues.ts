import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { ActorRef, FieldValue, Issue, IssueLinkType, User } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { emitEvent } from '../engine';
import { persistState, run, stateDb } from '../db/core';
import { getIssue, getProject, getWorkflow, listAttachmentsFor, listCommentsFor, listIssueLinksFor, listWorklogsFor } from '../queries';

export const issuesRouter = new Hono<{ Variables: AuthVariables }>();

function actorFrom(user: User): ActorRef {
  return { kind: 'user', userId: user.id };
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

  const project = await getProject();
  const workflow = await getWorkflow();
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
    assigneeId: body.assigneeId as string | undefined,
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
  const event = await emitEvent({ actor: actorFrom(user), subject: { type: 'issue', id: issue.id }, payload: { type: 'issue.created', issueId: issue.id, issue } });
  return c.json({ issue: await getIssue(issue.id), event }, 201);
});

/**
 * PATCH /api/issues/:id — edits built-in issue fields. Diffs the body against the current
 * issue so each kind of change emits the event it should: `statusId` -> `issue.statusChanged`,
 * `assigneeId` -> `issue.assigned`, `sprintId` -> `issue.sprintChanged`, everything else
 * (title, description, priority, labels, components, fix versions, points, due date,
 * estimates) -> a single `issue.updated` with a `changes` map. Custom field values are
 * handled by PATCH /api/issues/:id/fields/:fieldId instead.
 */
issuesRouter.patch('/issues/:id', async (c) => {
  const id = c.req.param('id');
  const issue = await getIssue(id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const actor = actorFrom(c.get('user'));

  if ('statusId' in body && body.statusId !== issue.statusId) {
    await emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.statusChanged', issueId: id, fromStatusId: issue.statusId, toStatusId: body.statusId as string } });
  }
  if ('assigneeId' in body && body.assigneeId !== issue.assigneeId) {
    await emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.assigned', issueId: id, fromUserId: issue.assigneeId, toUserId: body.assigneeId as string | undefined } });
  }
  if ('sprintId' in body && body.sprintId !== issue.sprintId) {
    await emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.sprintChanged', issueId: id, fromSprintId: issue.sprintId, toSprintId: body.sprintId as string | undefined } });
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
    await emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.updated', issueId: id, changes } });
  }

  return c.json({ issue: await getIssue(id) });
});

/** PATCH /api/issues/:id/fields/:fieldId — sets one custom field's value; emits `issue.fieldChanged`. */
issuesRouter.patch('/issues/:id/fields/:fieldId', async (c) => {
  const id = c.req.param('id');
  const fieldId = c.req.param('fieldId');
  const issue = await getIssue(id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);

  const body = await c.req.json<{ value: FieldValue['value'] }>();
  const fromValue = issue.fieldValues.find((f) => f.fieldId === fieldId)?.value ?? null;

  const event = await emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'issue', id },
    payload: { type: 'issue.fieldChanged', issueId: id, fieldId, fromValue, toValue: body.value },
  });
  return c.json({ issue: await getIssue(id), event });
});

/** DELETE /api/issues/:id — deletes an issue and cascades to its comments/watchers/worklogs/attachments/links. */
issuesRouter.delete('/issues/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await getIssue(id))) return c.json({ error: 'Issue not found' }, 404);

  const event = await emitEvent({ actor: actorFrom(c.get('user')), subject: { type: 'issue', id }, payload: { type: 'issue.deleted', issueId: id } });
  return c.json({ event });
});

/** POST /api/issues/:id/comments — adds a comment; emits `comment.created`. */
issuesRouter.post('/issues/:id/comments', async (c) => {
  const id = c.req.param('id');
  if (!(await getIssue(id))) return c.json({ error: 'Issue not found' }, 404);

  const user = c.get('user');
  const body = await c.req.json<{ body: string }>();
  if (!body.body?.trim()) return c.json({ error: 'Comment body is required' }, 400);

  const commentId = `cmt_${randomUUID()}`;
  const event = await emitEvent({
    actor: actorFrom(user),
    subject: { type: 'comment', id: commentId },
    payload: { type: 'comment.created', commentId, issueId: id, authorId: user.id, body: body.body.trim() },
  });
  const comment = (await listCommentsFor(id)).find((cm) => cm.id === commentId);
  return c.json({ comment, event }, 201);
});

/** POST /api/issues/:id/links — links two issues; emits `issue.linked`. */
issuesRouter.post('/issues/:id/links', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ type: IssueLinkType; targetIssueId: string }>();
  if (!(await getIssue(id)) || !(await getIssue(body.targetIssueId))) return c.json({ error: 'Issue not found' }, 404);

  const linkId = `link_${randomUUID()}`;
  const event = await emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'issue', id },
    payload: { type: 'issue.linked', issueId: id, linkId, linkedIssueId: body.targetIssueId, linkType: body.type },
  });
  const link = (await listIssueLinksFor(id)).find((l) => l.id === linkId);
  return c.json({ link, event }, 201);
});

/** DELETE /api/issues/:issueId/links/:linkId — removes a link; emits `issue.unlinked`. */
issuesRouter.delete('/issues/:issueId/links/:linkId', async (c) => {
  const { issueId, linkId } = c.req.param();
  const event = await emitEvent({ actor: actorFrom(c.get('user')), subject: { type: 'issue', id: issueId }, payload: { type: 'issue.unlinked', issueId, linkId } });
  return c.json({ event });
});

/** POST /api/issues/:id/watchers — the caller starts watching; emits `issue.watcherAdded`. Idempotent. */
issuesRouter.post('/issues/:id/watchers', async (c) => {
  const id = c.req.param('id');
  if (!(await getIssue(id))) return c.json({ error: 'Issue not found' }, 404);
  const user = c.get('user');
  const event = await emitEvent({ actor: actorFrom(user), subject: { type: 'issue', id }, payload: { type: 'issue.watcherAdded', issueId: id, userId: user.id } });
  return c.json({ event }, 201);
});

/** DELETE /api/issues/:id/watchers — the caller stops watching; emits `issue.watcherRemoved`. */
issuesRouter.delete('/issues/:id/watchers', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const event = await emitEvent({ actor: actorFrom(user), subject: { type: 'issue', id }, payload: { type: 'issue.watcherRemoved', issueId: id, userId: user.id } });
  return c.json({ event });
});

/** POST /api/issues/:id/worklogs — logs time; bumps `issue.loggedSeconds`; emits `issue.worklogAdded`. */
issuesRouter.post('/issues/:id/worklogs', async (c) => {
  const id = c.req.param('id');
  if (!(await getIssue(id))) return c.json({ error: 'Issue not found' }, 404);

  const user = c.get('user');
  const body = await c.req.json<{ timeSpentSeconds: number; note?: string }>();
  if (!body.timeSpentSeconds || body.timeSpentSeconds <= 0) return c.json({ error: 'timeSpentSeconds must be positive' }, 400);

  const worklogId = `wl_${randomUUID()}`;
  const event = await emitEvent({
    actor: actorFrom(user),
    subject: { type: 'issue', id },
    payload: { type: 'issue.worklogAdded', issueId: id, worklogId, authorId: user.id, timeSpentSeconds: body.timeSpentSeconds, note: body.note },
  });
  const worklog = (await listWorklogsFor(id)).find((w) => w.id === worklogId);
  return c.json({ worklog, issue: await getIssue(id), event }, 201);
});

/**
 * POST /api/issues/:id/attachments — attaches a file by URL (no upload storage in this
 * prototype — the client supplies a URL it already hosts the file at). Emits `issue.attachmentAdded`.
 */
issuesRouter.post('/issues/:id/attachments', async (c) => {
  const id = c.req.param('id');
  if (!(await getIssue(id))) return c.json({ error: 'Issue not found' }, 404);

  const user = c.get('user');
  const body = await c.req.json<{ fileName: string; url: string; mimeType?: string; sizeBytes?: number }>();
  if (!body.url?.trim() || !body.fileName?.trim()) return c.json({ error: 'fileName and url are required' }, 400);

  const attachmentId = `att_${randomUUID()}`;
  const event = await emitEvent({
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
  const attachment = (await listAttachmentsFor(id)).find((a) => a.id === attachmentId);
  return c.json({ attachment, event }, 201);
});

/** DELETE /api/attachments/:id — removes an attachment record (not event-worthy; config-adjacent). */
issuesRouter.delete('/attachments/:id', (c) => {
  const id = c.req.param('id');
  run(stateDb, `DELETE FROM attachments WHERE id = ?`, [id]);
  persistState();
  return c.json({ ok: true });
});
