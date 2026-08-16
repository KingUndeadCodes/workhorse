import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { rowToAttachment, rowToBranch, rowToComment, rowToIssue, rowToIssueLink, rowToWorklog } from '../db/mappers';
import type { Attachment, Branch, Comment, FieldValue, Issue, IssueLink, IssueLinkType, Worklog } from '../domain';

/**
 * The only repository with INSERT/UPDATE/DELETE access to the operational tables: issues
 * and everything hung off one (comments, worklogs, attachments, links). Every
 * write here is driven either by {@link EventProjector} (from a payload already appended to
 * the durable log) or, for attachments, directly from a route (attachment removal isn't
 * event-worthy — see issues.ts's original comment). None of these methods call
 * `persistState()` themselves — the caller (the projector, or the route for attachment
 * deletion) controls when the snapshot is flushed, same as before this became a class.
 */
export class IssueRepository {
  constructor(private readonly db: Kysely<DB>) {}

  // ---- Reads ----

  async list(projectId: string): Promise<Issue[]> {
    return (await this.db.selectFrom('issues').selectAll().where('project_id', '=', projectId).execute()).map(rowToIssue);
  }

  /** Every issue across every project — for {@link AuditService}, which replays the whole workspace's event log, not one project's slice of it. */
  async listAll(): Promise<Issue[]> {
    return (await this.db.selectFrom('issues').selectAll().execute()).map(rowToIssue);
  }

  async get(id: string): Promise<Issue | undefined> {
    const row = await this.db.selectFrom('issues').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToIssue(row) : undefined;
  }

  /** Issue ids belonging to `projectId` — the subquery every other per-project list below joins through, since links/comments/worklogs/attachments hang off `issue_id`, not `project_id`, directly. */
  private issueIdsInProject(projectId: string) {
    return this.db.selectFrom('issues').select('id').where('project_id', '=', projectId);
  }

  async listLinks(projectId: string): Promise<IssueLink[]> {
    return (
      await this.db
        .selectFrom('issue_links')
        .selectAll()
        .where((eb) => eb.or([eb('source_issue_id', 'in', this.issueIdsInProject(projectId)), eb('target_issue_id', 'in', this.issueIdsInProject(projectId))]))
        .execute()
    ).map(rowToIssueLink);
  }

  async listLinksFor(issueId: string): Promise<IssueLink[]> {
    return (
      await this.db
        .selectFrom('issue_links')
        .selectAll()
        .where((eb) => eb.or([eb('source_issue_id', '=', issueId), eb('target_issue_id', '=', issueId)]))
        .execute()
    ).map(rowToIssueLink);
  }

  async listComments(projectId: string): Promise<Comment[]> {
    return (
      await this.db.selectFrom('comments').selectAll().where('issue_id', 'in', this.issueIdsInProject(projectId)).orderBy('created_at', 'asc').execute()
    ).map(rowToComment);
  }

  async listCommentsFor(issueId: string): Promise<Comment[]> {
    return (await this.db.selectFrom('comments').selectAll().where('issue_id', '=', issueId).orderBy('created_at', 'asc').execute()).map(rowToComment);
  }

  async getComment(commentId: string): Promise<Comment | undefined> {
    const row = await this.db.selectFrom('comments').selectAll().where('id', '=', commentId).executeTakeFirst();
    return row ? rowToComment(row) : undefined;
  }

  async listWorklogs(projectId: string): Promise<Worklog[]> {
    return (
      await this.db.selectFrom('worklogs').selectAll().where('issue_id', 'in', this.issueIdsInProject(projectId)).orderBy('started_at', 'asc').execute()
    ).map(rowToWorklog);
  }

  async listWorklogsFor(issueId: string): Promise<Worklog[]> {
    return (await this.db.selectFrom('worklogs').selectAll().where('issue_id', '=', issueId).orderBy('started_at', 'asc').execute()).map(rowToWorklog);
  }

  async listAttachments(projectId: string): Promise<Attachment[]> {
    return (await this.db.selectFrom('attachments').selectAll().where('issue_id', 'in', this.issueIdsInProject(projectId)).execute()).map(rowToAttachment);
  }

  async listAttachmentsFor(issueId: string): Promise<Attachment[]> {
    return (await this.db.selectFrom('attachments').selectAll().where('issue_id', '=', issueId).execute()).map(rowToAttachment);
  }

  async getBranchFor(issueId: string): Promise<Branch | undefined> {
    const row = await this.db.selectFrom('branches').selectAll().where('issue_id', '=', issueId).executeTakeFirst();
    return row ? rowToBranch(row) : undefined;
  }

  async listBranchesFor(issueIds: string[]): Promise<Branch[]> {
    if (issueIds.length === 0) return [];
    return (await this.db.selectFrom('branches').selectAll().where('issue_id', 'in', issueIds).execute()).map(rowToBranch);
  }

  // ---- Writes (see class doc — caller persists) ----

  async insert(issue: Issue): Promise<void> {
    await this.db
      .insertInto('issues')
      .values({
        id: issue.id,
        key: issue.key,
        project_id: issue.projectId,
        issue_type_id: issue.issueTypeId,
        status_id: issue.statusId,
        title: issue.title,
        description: JSON.stringify(issue.description ?? null),
        priority: issue.priority,
        reporter_id: issue.reporterId,
        assignee_ids: JSON.stringify(issue.assigneeIds),
        agent_assignments: JSON.stringify(issue.agentAssignments ?? null),
        parent_id: issue.parentId ?? null,
        additional_parent_ids: JSON.stringify(issue.additionalParentIds ?? null),
        label_ids: JSON.stringify(issue.labelIds),
        component_ids: JSON.stringify(issue.componentIds),
        fix_version_ids: JSON.stringify(issue.fixVersionIds),
        sprint_id: issue.sprintId ?? null,
        story_points: issue.storyPoints ?? null,
        original_estimate_seconds: issue.originalEstimateSeconds ?? null,
        remaining_estimate_seconds: issue.remainingEstimateSeconds ?? null,
        logged_seconds: issue.loggedSeconds,
        field_values: JSON.stringify(issue.fieldValues),
        due_date: issue.dueDate ?? null,
        created_at: issue.createdAt,
        updated_at: issue.updatedAt,
        resolved_at: issue.resolvedAt ?? null,
      })
      .execute();
  }

  async updateStatus(issueId: string, toStatusId: string, occurredAt: string): Promise<void> {
    await this.db.updateTable('issues').set({ status_id: toStatusId, updated_at: occurredAt }).where('id', '=', issueId).execute();
  }

  /** Overwrites the full (human) assignee list. Agents are never in this list — see {@link assignAgent}. */
  async updateAssignees(issueId: string, toUserIds: string[], occurredAt: string): Promise<void> {
    await this.db.updateTable('issues').set({ assignee_ids: JSON.stringify(toUserIds), updated_at: occurredAt }).where('id', '=', issueId).execute();
  }

  /** Attaches an agent to an issue on behalf of one of its current human assignees, or replaces an existing attachment. */
  async assignAgent(issueId: string, agentUserId: string, onBehalfOfUserId: string, occurredAt: string): Promise<void> {
    const current = await this.get(issueId);
    const agentAssignments = { ...(current?.agentAssignments ?? {}), [agentUserId]: onBehalfOfUserId };
    await this.db
      .updateTable('issues')
      .set({ agent_assignments: JSON.stringify(agentAssignments), updated_at: occurredAt })
      .where('id', '=', issueId)
      .execute();
  }

  /** Detaches an agent from an issue — used both for explicit removal and the cascade when its on-behalf-of assignee is removed. */
  async unassignAgent(issueId: string, agentUserId: string, occurredAt: string): Promise<void> {
    const current = await this.get(issueId);
    const agentAssignments = { ...(current?.agentAssignments ?? {}) };
    delete agentAssignments[agentUserId];
    await this.db
      .updateTable('issues')
      .set({ agent_assignments: JSON.stringify(agentAssignments), updated_at: occurredAt })
      .where('id', '=', issueId)
      .execute();
  }

  async updateSprint(issueId: string, toSprintId: string | undefined, occurredAt: string): Promise<void> {
    await this.db.updateTable('issues').set({ sprint_id: toSprintId ?? null, updated_at: occurredAt }).where('id', '=', issueId).execute();
  }

  /** Applies a generic field-diff map (title, description, priority, labels, etc.) — same column mapping `issue.updated` events have always used. */
  async updateFields(issueId: string, changes: Record<string, unknown>, occurredAt: string): Promise<void> {
    const columnByField: Record<string, string> = {
      title: 'title',
      priority: 'priority',
      storyPoints: 'story_points',
      dueDate: 'due_date',
      originalEstimateSeconds: 'original_estimate_seconds',
      remainingEstimateSeconds: 'remaining_estimate_seconds',
      labelIds: 'label_ids',
      componentIds: 'component_ids',
      fixVersionIds: 'fix_version_ids',
    };
    const jsonFields = new Set(['labelIds', 'componentIds', 'fixVersionIds']);
    const set: Record<string, unknown> = { updated_at: occurredAt };
    for (const [field, value] of Object.entries(changes)) {
      if (field === 'description') {
        set.description = JSON.stringify(value);
        continue;
      }
      const column = columnByField[field];
      if (!column) continue;
      set[column] = jsonFields.has(field) ? JSON.stringify(value) : value;
    }
    if (Object.keys(set).length <= 1) return; // only updated_at — nothing recognized to change
    await this.db.updateTable('issues').set(set as never).where('id', '=', issueId).execute();
  }

  async setFieldValue(issueId: string, fieldId: string, toValue: FieldValue['value'], occurredAt: string): Promise<void> {
    const issue = await this.get(issueId);
    if (!issue) return;
    const next = issue.fieldValues.filter((f) => f.fieldId !== fieldId);
    next.push({ fieldId, value: toValue });
    await this.db.updateTable('issues').set({ field_values: JSON.stringify(next), updated_at: occurredAt }).where('id', '=', issueId).execute();
  }

  async deleteCascade(issueId: string): Promise<void> {
    await this.db.deleteFrom('issues').where('id', '=', issueId).execute();
    await this.db.deleteFrom('comments').where('issue_id', '=', issueId).execute();
    await this.db.deleteFrom('worklogs').where('issue_id', '=', issueId).execute();
    await this.db.deleteFrom('attachments').where('issue_id', '=', issueId).execute();
    await this.db.deleteFrom('branches').where('issue_id', '=', issueId).execute();
    await this.db
      .deleteFrom('issue_links')
      .where((eb) => eb.or([eb('source_issue_id', '=', issueId), eb('target_issue_id', '=', issueId)]))
      .execute();
  }

  async insertLink(link: IssueLink): Promise<void> {
    await this.db
      .insertInto('issue_links')
      .values({ id: link.id, type: link.type, source_issue_id: link.sourceIssueId, target_issue_id: link.targetIssueId, created_at: link.createdAt, created_by: link.createdBy })
      .execute();
  }

  buildLink(linkId: string, issueId: string, targetIssueId: string, type: IssueLinkType, createdAt: string, createdBy: string): IssueLink {
    return { id: linkId, type, sourceIssueId: issueId, targetIssueId, createdAt, createdBy };
  }

  async deleteLink(linkId: string): Promise<void> {
    await this.db.deleteFrom('issue_links').where('id', '=', linkId).execute();
  }

  async insertWorklog(worklog: Worklog, occurredAt: string): Promise<void> {
    await this.db
      .insertInto('worklogs')
      .values({ id: worklog.id, issue_id: worklog.issueId, author_id: worklog.authorId, time_spent_seconds: worklog.timeSpentSeconds, started_at: worklog.startedAt, note: worklog.note ?? null })
      .execute();
    await this.db
      .updateTable('issues')
      .set((eb) => ({ logged_seconds: eb('logged_seconds', '+', worklog.timeSpentSeconds), updated_at: occurredAt }))
      .where('id', '=', worklog.issueId)
      .execute();
  }

  async insertAttachment(attachment: Attachment): Promise<void> {
    await this.db
      .insertInto('attachments')
      .values({
        id: attachment.id,
        issue_id: attachment.issueId,
        uploaded_by: attachment.uploadedBy,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
        url: attachment.url,
        created_at: attachment.createdAt,
      })
      .execute();
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.db.deleteFrom('attachments').where('id', '=', id).execute();
  }

  async insertBranch(branch: Branch): Promise<void> {
    await this.db
      .insertInto('branches')
      .values({
        id: branch.id,
        issue_id: branch.issueId,
        git_repo_link_id: branch.gitRepoLinkId,
        name: branch.name,
        url: branch.url,
        created_at: branch.createdAt,
        created_by: branch.createdBy,
      })
      .execute();
  }

  async deleteBranchFor(issueId: string): Promise<void> {
    await this.db.deleteFrom('branches').where('issue_id', '=', issueId).execute();
  }

  async insertComment(comment: Comment): Promise<void> {
    await this.db
      .insertInto('comments')
      .values({
        id: comment.id,
        issue_id: comment.issueId,
        author_id: comment.authorId,
        on_behalf_of_user_id: comment.onBehalfOfUserId ?? null,
        body: JSON.stringify(comment.body),
        created_at: comment.createdAt,
        parent_comment_id: comment.parentCommentId ?? null,
      })
      .execute();
  }

  /** Overwrites a comment's body (and marks it edited) — the only mutation a comment gets after creation. */
  async updateComment(commentId: string, plainText: string, editedAt: string): Promise<void> {
    const row = await this.db.selectFrom('comments').select('body').where('id', '=', commentId).executeTakeFirst();
    const existingBody = row?.body ? JSON.parse(row.body) : { format: 'richtext-v1', content: null, plainText: '' };
    const body = { ...existingBody, plainText };
    await this.db.updateTable('comments').set({ body: JSON.stringify(body), edited_at: editedAt }).where('id', '=', commentId).execute();
  }

  /**
   * Deletes a comment and every reply beneath it, to any depth — the whole subtree, not just
   * the one row. Collected breadth-first in application code rather than a recursive SQL query
   * (sql.js's SQLite build doesn't reliably support `WITH RECURSIVE` through Kysely here), then
   * removed in one statement. The route calling this (DELETE /issues/:issueId/comments/:id)
   * confirms with the user client-side first — this method itself doesn't ask.
   */
  async deleteComment(commentId: string): Promise<void> {
    const toDelete = [commentId];
    for (let i = 0; i < toDelete.length; i++) {
      const children = await this.db.selectFrom('comments').select('id').where('parent_comment_id', '=', toDelete[i]).execute();
      toDelete.push(...children.map((c) => c.id));
    }
    await this.db.deleteFrom('comments').where('id', 'in', toDelete).execute();
  }
}
