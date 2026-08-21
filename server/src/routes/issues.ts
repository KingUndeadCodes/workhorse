import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { ActorRef, FieldValue, Issue, IssueLinkType, IssuePriority, User } from '../domain';
import { parseMentionedUserIds, slugifyBranchName, STORY_POINT_VALUES } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { agentRepo, engine, gitProviders, gitRepoLinkRepo, issueRepo, projectRepo, userRepo, workflowRepo, workspaceRepo } from '../container';
import { getEventsForIssue } from '../eventLog';
import { setsEqual } from '../util';

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
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  if (!title || !issueTypeId || !projectId) return c.json({ error: 'title, issueTypeId, and projectId are required' }, 400);
  if (await containsAgentId((body.assigneeIds as string[]) ?? [])) {
    return c.json({ error: "Agents can't be assignees — add them from the AI Agents section after creating the issue" }, 400);
  }
  if (!isValidStoryPoints(body.storyPoints)) {
    return c.json({ error: `storyPoints must be one of ${STORY_POINT_VALUES.join(', ')}` }, 400);
  }

  const project = await projectRepo.getProjectById(projectId);
  if (!project) return c.json({ error: 'Unknown projectId' }, 400);
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
    reporterId: user.id,
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
 * issue so each kind of change emits the event it should: `statusId` -> `issue.statusChanged`
 * (plus `issue.resolved`/`issue.reopened` if the transition crosses a done-category boundary —
 * see EventEngine.classifyStatusTransition), `assigneeIds` -> `issue.assigneesChanged`,
 * `sprintId` -> `issue.sprintChanged`, `priority` -> `issue.priorityChanged`, `labelIds` ->
 * `issue.labelsChanged`, `dueDate` -> `issue.dueDateChanged`, everything else (title,
 * description, components, fix versions, points, estimates) -> a single `issue.updated` with a
 * `changes` map — those stay lumped together since nothing has needed to filter on them
 * individually yet; pull one out the same way priority/labels/dueDate were if that changes.
 * Custom field values are handled by PATCH /api/issues/:id/fields/:fieldId instead.
 */
issuesRouter.patch('/issues/:id', async (c) => {
  const id = c.req.param('id');
  const issue = await issueRepo.get(id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const actor = actorFrom(c.get('user'));

  // Every 400-worthy validation runs before any emitEvent below — this PATCH applies up to
  // seven independent changes as separate sequential events with no cross-database
  // transaction wrapping them (the event log and state db are separate sql.js instances), so
  // a validation failure discovered partway through would otherwise leave earlier changes
  // applied while the client only sees an error with no updated issue.
  if ('storyPoints' in body && !isValidStoryPoints(body.storyPoints)) {
    return c.json({ error: `storyPoints must be one of ${STORY_POINT_VALUES.join(', ')}` }, 400);
  }
  if ('assigneeIds' in body && (await containsAgentId((body.assigneeIds as string[]) ?? []))) {
    return c.json({ error: "Agents can't be assignees — add them from the AI Agents section instead" }, 400);
  }

  if ('statusId' in body && body.statusId !== issue.statusId) {
    const toStatusId = body.statusId as string;
    await engine.emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.statusChanged', issueId: id, fromStatusId: issue.statusId, toStatusId } });
    const transition = await engine.classifyStatusTransition(issue.statusId, toStatusId);
    if (transition) {
      await engine.emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: `issue.${transition}`, issueId: id, statusId: toStatusId } });
    }
  }
  if ('assigneeIds' in body) {
    const toUserIds = (body.assigneeIds as string[]) ?? [];
    if (!setsEqual(new Set(toUserIds), new Set(issue.assigneeIds))) {
      await engine.emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.assigneesChanged', issueId: id, fromUserIds: issue.assigneeIds, toUserIds } });
    }
  }
  if ('sprintId' in body && body.sprintId !== issue.sprintId) {
    await engine.emitEvent({ actor, subject: { type: 'issue', id }, payload: { type: 'issue.sprintChanged', issueId: id, fromSprintId: issue.sprintId, toSprintId: body.sprintId as string | undefined } });
  }
  if ('priority' in body && body.priority !== issue.priority) {
    await engine.emitEvent({
      actor,
      subject: { type: 'issue', id },
      payload: { type: 'issue.priorityChanged', issueId: id, fromPriority: issue.priority, toPriority: body.priority as IssuePriority },
    });
  }
  if ('labelIds' in body) {
    const toLabelIds = (body.labelIds as string[]) ?? [];
    if (!setsEqual(new Set(toLabelIds), new Set(issue.labelIds))) {
      await engine.emitEvent({
        actor,
        subject: { type: 'issue', id },
        payload: { type: 'issue.labelsChanged', issueId: id, fromLabelIds: issue.labelIds, toLabelIds },
      });
    }
  }
  if ('dueDate' in body && body.dueDate !== issue.dueDate) {
    await engine.emitEvent({
      actor,
      subject: { type: 'issue', id },
      payload: { type: 'issue.dueDateChanged', issueId: id, fromDueDate: issue.dueDate, toDueDate: body.dueDate as string | undefined },
    });
  }

  const genericFields = ['title', 'description', 'componentIds', 'fixVersionIds', 'storyPoints', 'originalEstimateSeconds', 'remainingEstimateSeconds'] as const;
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
 * GET /api/issues/:id/events -> `{ events }` — every logged event concerning this issue
 * (status/field/assignee changes, comments and their edits, links, worklogs, branches, ...),
 * oldest first. Powers the Activity tab. Deliberately lightweight (id/time/actor/type only,
 * not the full payload) — the point of the list is a scannable feed, and a workspace with a
 * long history shouldn't have to ship every changed field/comment body for every row just to
 * render it. A row's full detail is a separate, per-event fetch (`GET /api/events/:id`),
 * made only when a user actually expands that row.
 */
issuesRouter.get('/issues/:id/events', async (c) => {
  const id = c.req.param('id');
  const workspace = await workspaceRepo.getWorkspace();
  const events = getEventsForIssue(workspace.id, id).map((e) => ({ id: e.id, occurredAt: e.occurredAt, actor: e.actor, type: e.payload.type }));
  return c.json({ events });
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
  const commentBody = body.body.trim();
  const event = await engine.emitEvent({
    actor: actorFrom(user),
    subject: { type: 'comment', id: commentId },
    payload: { type: 'comment.created', commentId, issueId: id, authorId: user.id, body: commentBody, parentCommentId },
  });

  const mentionedUserIds = parseMentionedUserIds(commentBody, await userRepo.list()).filter((uid) => uid !== user.id);
  for (const mentionedUserId of mentionedUserIds) {
    await engine.emitEvent({
      actor: actorFrom(user),
      subject: { type: 'comment', id: commentId },
      payload: { type: 'comment.mentioned', commentId, issueId: id, authorId: user.id, mentionedUserId, body: commentBody },
    });
  }

  const comment = (await issueRepo.listCommentsFor(id)).find((cm) => cm.id === commentId);
  return c.json({ comment, event }, 201);
});

/**
 * PATCH /api/issues/:issueId/comments/:commentId — edits a comment's body; emits
 * `comment.edited`. Only the comment's own author may edit it. Also re-parses mentions and
 * emits `comment.mentioned` for any that are new in the edited body — e.g. adding "@Name" to a
 * comment that didn't have it, or one that was written and immediately edited before the
 * mentioned person could see the original. Mentions already present before the edit don't fire
 * again, so re-saving an unrelated change doesn't re-notify everyone already mentioned.
 */
issuesRouter.patch('/issues/:issueId/comments/:commentId', async (c) => {
  const { issueId, commentId } = c.req.param();
  const comment = await issueRepo.getComment(commentId);
  if (!comment || comment.issueId !== issueId) return c.json({ error: 'Comment not found' }, 404);

  const user = c.get('user');
  if (comment.authorId !== user.id) return c.json({ error: 'Only the comment author can edit it' }, 403);

  const body = await c.req.json<{ body: string }>();
  if (!body.body?.trim()) return c.json({ error: 'Comment body is required' }, 400);
  const newBody = body.body.trim();

  const allUsers = await userRepo.list();
  const mentionedBefore = new Set(parseMentionedUserIds(comment.body.plainText, allUsers));
  const mentionedAfter = parseMentionedUserIds(newBody, allUsers).filter((uid) => uid !== user.id && !mentionedBefore.has(uid));

  const event = await engine.emitEvent({
    actor: actorFrom(user),
    subject: { type: 'comment', id: commentId },
    payload: { type: 'comment.edited', commentId, issueId, body: newBody },
  });

  for (const mentionedUserId of mentionedAfter) {
    await engine.emitEvent({
      actor: actorFrom(user),
      subject: { type: 'comment', id: commentId },
      payload: { type: 'comment.mentioned', commentId, issueId, authorId: user.id, mentionedUserId, body: newBody },
    });
  }

  return c.json({ comment: await issueRepo.getComment(commentId), event });
});

/** DELETE /api/issues/:issueId/comments/:commentId — deletes a comment and every reply beneath it; emits `comment.deleted` for the root comment only (the whole subtree is one user action, same as issue.deleted's cascade). Only the comment's own author may delete it. */
issuesRouter.delete('/issues/:issueId/comments/:commentId', async (c) => {
  const { issueId, commentId } = c.req.param();
  const comment = await issueRepo.getComment(commentId);
  if (!comment || comment.issueId !== issueId) return c.json({ error: 'Comment not found' }, 404);

  const user = c.get('user');
  if (comment.authorId !== user.id) return c.json({ error: 'Only the comment author can delete it' }, 403);

  const event = await engine.emitEvent({
    actor: actorFrom(user),
    subject: { type: 'comment', id: commentId },
    payload: { type: 'comment.deleted', commentId, issueId },
  });
  return c.json({ event });
});

/** POST /api/issues/:id/links — links two issues; emits `issue.linked`. */
issuesRouter.post('/issues/:id/links', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ type: IssueLinkType; targetIssueId: string }>();
  if (id === body.targetIssueId) return c.json({ error: "An issue can't be linked to itself" }, 400);
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
  const link = (await issueRepo.listLinksFor(issueId)).find((l) => l.id === linkId);
  if (!link) return c.json({ error: 'Link not found' }, 404);

  const event = await engine.emitEvent({ actor: actorFrom(c.get('user')), subject: { type: 'issue', id: issueId }, payload: { type: 'issue.unlinked', issueId, linkId } });
  return c.json({ event });
});

/**
 * POST /api/issues/:id/agents — attaches an AI agent to an issue, simple membership like an
 * assignee. Emits `issue.agentAssigned` — its `actor` is who attached the agent, so that's
 * still recoverable from the event log even though it's no longer carried as ongoing state on
 * the issue. Body: `{ agentUserId }`. 400 if `agentUserId` isn't a real agent.
 */
issuesRouter.post('/issues/:id/agents', async (c) => {
  const id = c.req.param('id');
  const issue = await issueRepo.get(id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);

  const body = await c.req.json<{ agentUserId: string }>();
  if (!(await agentRepo.get(body.agentUserId))) return c.json({ error: 'Agent not found' }, 400);
  if (issue.agentAssignments?.includes(body.agentUserId)) return c.json({ error: 'Agent already attached to this issue' }, 400);

  const event = await engine.emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'issue', id },
    payload: { type: 'issue.agentAssigned', issueId: id, agentUserId: body.agentUserId },
  });
  return c.json({ issue: await issueRepo.get(id), event }, 201);
});

/** DELETE /api/issues/:id/agents/:agentUserId — detaches an agent from the issue; emits `issue.agentUnassigned`. */
issuesRouter.delete('/issues/:id/agents/:agentUserId', async (c) => {
  const { id, agentUserId } = c.req.param();
  const issue = await issueRepo.get(id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);
  if (!issue.agentAssignments?.includes(agentUserId)) return c.json({ error: 'Agent not attached to this issue' }, 404);

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

/** DELETE /api/attachments/:id — removes an attachment record; emits `issue.attachmentRemoved` (its addition is event-sourced too, so AuditService's replay stays symmetric). Only the uploader may delete it. */
issuesRouter.delete('/attachments/:id', async (c) => {
  const id = c.req.param('id');
  const attachment = await issueRepo.getAttachment(id);
  if (!attachment) return c.json({ error: 'Attachment not found' }, 404);
  if (attachment.uploadedBy !== c.get('user').id) return c.json({ error: 'Only the uploader can delete this attachment' }, 403);
  await engine.emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'issue', id: attachment.issueId },
    payload: { type: 'issue.attachmentRemoved', issueId: attachment.issueId, attachmentId: id },
  });
  return c.json({ ok: true });
});

/** GET /api/issues/:id/branch -> `{ branch: Branch | null }`. */
issuesRouter.get('/issues/:id/branch', async (c) => {
  const branch = await issueRepo.getBranchFor(c.req.param('id'));
  return c.json({ branch: branch ?? null });
});

/**
 * POST /api/issues/:id/branch — creates a live branch on the issue's project's linked repo
 * via its registered {@link GitProvider} (no local git — just a ref lookup + create). Body:
 * `{ name? }`, defaults to a slug derived from the issue key/title. 404 if the issue doesn't
 * exist, 400 if the issue already has a branch or the project has no linked repo, 502 if the
 * provider call fails (its error message is surfaced, since this is a synchronous user
 * action, not a fire-and-forget dispatch like webhooks). Emits `issue.branchCreated` on success.
 */
issuesRouter.post('/issues/:id/branch', async (c) => {
  const id = c.req.param('id');
  const issue = await issueRepo.get(id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);
  if (await issueRepo.getBranchFor(id)) return c.json({ error: 'Issue already has a branch' }, 400);
  const link = await gitRepoLinkRepo.getForProject(issue.projectId);
  if (!link) return c.json({ error: 'This project has no linked git repository' }, 400);

  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = body.name?.trim() || slugifyBranchName(issue.key, issue.title);

  let result: { url: string };
  try {
    result = await gitProviders.resolve(link.provider).createBranch({ owner: link.owner, repo: link.repo, token: link.token, fromBranch: link.defaultBranch, newBranchName: name });
  } catch (err) {
    return c.json({ error: `Branch creation failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  const branchId = `branch_${randomUUID()}`;
  let event;
  try {
    event = await engine.emitEvent({
      actor: actorFrom(c.get('user')),
      subject: { type: 'issue', id },
      payload: { type: 'issue.branchCreated', issueId: id, branchId, gitRepoLinkId: link.id, name, url: result.url },
    });
  } catch (err) {
    // The unique index on branches(issue_id) is what actually enforces "at most one branch
    // per issue" — the check above is only a fast path, not a lock, so a concurrent request
    // can still lose the race here. Surface that as the same 400 the fast path returns,
    // rather than a raw constraint-violation 500 — the remote ref this request just created
    // is orphaned in that case, but no duplicate row is written.
    if (err instanceof Error && /unique/i.test(err.message)) {
      return c.json({ error: 'Issue already has a branch' }, 400);
    }
    throw err;
  }
  const branch = await issueRepo.getBranchFor(id);
  return c.json({ branch, event }, 201);
});

/** DELETE /api/issues/:id/branch — removes the branch record only (no provider call — this app only ever creates refs, never deletes them remotely). Emits `issue.branchDeleted`. */
issuesRouter.delete('/issues/:id/branch', async (c) => {
  const id = c.req.param('id');
  const branch = await issueRepo.getBranchFor(id);
  if (!branch) return c.json({ error: 'Not found' }, 404);
  await engine.emitEvent({ actor: actorFrom(c.get('user')), subject: { type: 'issue', id }, payload: { type: 'issue.branchDeleted', issueId: id, branchId: branch.id } });
  return c.json({ ok: true });
});
