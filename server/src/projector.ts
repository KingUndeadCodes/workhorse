import type { AgentRun, Attachment, Comment, EventEnvelope, Issue, IssueLink, Watcher, Worklog } from './domain';
import { persistState, run, stateDb } from './db/core';
import { agentRunParams, ISSUE_COLUMNS, issueParams } from './db/mappers';
import { getIssue } from './queries';

/**
 * The only module in the server with INSERT/UPDATE/DELETE access to `state.db`'s
 * operational tables (issues and everything hung off one: comments, watchers, worklogs,
 * attachments, links; plus sprint lifecycle and agent runs). Every write here happens
 * either directly inside {@link applyEvent} — driven by a payload already appended to the
 * durable log — or, for agent-run bookkeeping, from engine.ts's reaction to one. Catalog
 * and reference data (labels, components, versions, field definitions, workflow
 * configuration, rule/agent/webhook *definitions*) are simple CRUD written straight from
 * their route handlers instead — that split is deliberate (see automations.ts's original
 * comment on why config isn't log-worthy activity), not an oversight.
 */
export async function applyEvent(event: EventEnvelope): Promise<void> {
  const { payload } = event;
  switch (payload.type) {
    case 'issue.created': {
      run(stateDb, `INSERT INTO issues (${ISSUE_COLUMNS.join(', ')}) VALUES (${ISSUE_COLUMNS.map(() => '?').join(', ')})`, issueParams(payload.issue));
      break;
    }
    case 'issue.statusChanged': {
      run(stateDb, `UPDATE issues SET status_id = ?, updated_at = ? WHERE id = ?`, [payload.toStatusId, event.occurredAt, payload.issueId]);
      break;
    }
    case 'issue.assigned': {
      run(stateDb, `UPDATE issues SET assignee_id = ?, updated_at = ? WHERE id = ?`, [payload.toUserId ?? null, event.occurredAt, payload.issueId]);
      break;
    }
    case 'issue.sprintChanged': {
      run(stateDb, `UPDATE issues SET sprint_id = ?, updated_at = ? WHERE id = ?`, [payload.toSprintId ?? null, event.occurredAt, payload.issueId]);
      break;
    }
    case 'issue.updated': {
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
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [field, value] of Object.entries(payload.changes)) {
        if (field === 'description') {
          sets.push('description = ?');
          params.push(JSON.stringify(value));
          continue;
        }
        const column = columnByField[field];
        if (!column) continue;
        sets.push(`${column} = ?`);
        params.push(jsonFields.has(field) ? JSON.stringify(value) : value);
      }
      if (sets.length > 0) {
        sets.push('updated_at = ?');
        params.push(event.occurredAt, payload.issueId);
        run(stateDb, `UPDATE issues SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      break;
    }
    case 'issue.fieldChanged': {
      const issue = await getIssue(payload.issueId);
      if (!issue) break;
      const next = issue.fieldValues.filter((f) => f.fieldId !== payload.fieldId);
      next.push({ fieldId: payload.fieldId, value: payload.toValue as Issue['fieldValues'][number]['value'] });
      run(stateDb, `UPDATE issues SET field_values = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(next), event.occurredAt, payload.issueId]);
      break;
    }
    case 'issue.deleted': {
      run(stateDb, `DELETE FROM issues WHERE id = ?`, [payload.issueId]);
      run(stateDb, `DELETE FROM comments WHERE issue_id = ?`, [payload.issueId]);
      run(stateDb, `DELETE FROM watchers WHERE issue_id = ?`, [payload.issueId]);
      run(stateDb, `DELETE FROM worklogs WHERE issue_id = ?`, [payload.issueId]);
      run(stateDb, `DELETE FROM attachments WHERE issue_id = ?`, [payload.issueId]);
      run(stateDb, `DELETE FROM issue_links WHERE source_issue_id = ? OR target_issue_id = ?`, [payload.issueId, payload.issueId]);
      break;
    }
    case 'issue.linked': {
      const link: IssueLink = { id: payload.linkId, type: payload.linkType, sourceIssueId: payload.issueId, targetIssueId: payload.linkedIssueId, createdAt: event.occurredAt, createdBy: event.actor.kind === 'user' ? event.actor.userId : 'u_leon' };
      run(stateDb, `INSERT INTO issue_links (id, type, source_issue_id, target_issue_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`, [
        link.id, link.type, link.sourceIssueId, link.targetIssueId, link.createdAt, link.createdBy,
      ]);
      break;
    }
    case 'issue.unlinked': {
      run(stateDb, `DELETE FROM issue_links WHERE id = ?`, [payload.linkId]);
      break;
    }
    case 'issue.watcherAdded': {
      run(stateDb, `INSERT OR IGNORE INTO watchers (issue_id, user_id, watching_since) VALUES (?, ?, ?)`, [payload.issueId, payload.userId, event.occurredAt]);
      break;
    }
    case 'issue.watcherRemoved': {
      run(stateDb, `DELETE FROM watchers WHERE issue_id = ? AND user_id = ?`, [payload.issueId, payload.userId]);
      break;
    }
    case 'issue.worklogAdded': {
      const worklog: Worklog = { id: payload.worklogId, issueId: payload.issueId, authorId: payload.authorId, timeSpentSeconds: payload.timeSpentSeconds, startedAt: event.occurredAt, note: payload.note };
      run(stateDb, `INSERT INTO worklogs (id, issue_id, author_id, time_spent_seconds, started_at, note) VALUES (?, ?, ?, ?, ?, ?)`, [
        worklog.id, worklog.issueId, worklog.authorId, worklog.timeSpentSeconds, worklog.startedAt, worklog.note ?? null,
      ]);
      run(stateDb, `UPDATE issues SET logged_seconds = logged_seconds + ?, updated_at = ? WHERE id = ?`, [payload.timeSpentSeconds, event.occurredAt, payload.issueId]);
      break;
    }
    case 'issue.attachmentAdded': {
      const attachment: Attachment = {
        id: payload.attachmentId, issueId: payload.issueId, uploadedBy: payload.uploadedBy, fileName: payload.fileName,
        mimeType: payload.mimeType, sizeBytes: payload.sizeBytes, url: payload.url, createdAt: event.occurredAt,
      };
      run(stateDb, `INSERT INTO attachments (id, issue_id, uploaded_by, file_name, mime_type, size_bytes, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        attachment.id, attachment.issueId, attachment.uploadedBy, attachment.fileName, attachment.mimeType, attachment.sizeBytes, attachment.url, attachment.createdAt,
      ]);
      break;
    }
    case 'comment.created': {
      const comment: Comment = { id: payload.commentId, issueId: payload.issueId, authorId: payload.authorId, body: { format: 'richtext-v1', content: null, plainText: payload.body }, createdAt: event.occurredAt };
      run(stateDb, `INSERT INTO comments (id, issue_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`, [comment.id, comment.issueId, comment.authorId, JSON.stringify(comment.body), comment.createdAt]);
      break;
    }
    case 'sprint.started': {
      run(stateDb, `UPDATE sprints SET state = 'active' WHERE id = ?`, [payload.sprintId]);
      break;
    }
    case 'sprint.completed': {
      run(stateDb, `UPDATE sprints SET state = 'closed', completed_at = ? WHERE id = ?`, [event.occurredAt, payload.sprintId]);
      break;
    }
    default:
      // Config-mutation echoes, agent/automation bookkeeping events, and anything else
      // without a direct state effect — nothing for the projector to do.
      break;
  }
  persistState();
}

/** Agent-run bookkeeping: not derived from a single event payload's `changes`, so it's a dedicated write rather than a case in the switch above. Still the only place agent_runs rows are written. */
export function upsertAgentRun(agentRun: AgentRun): void {
  run(
    stateDb,
    `INSERT INTO agent_runs (id, agent_user_id, triggering_event_id, status, proposed_actions, applied_action_indexes, rationale, reviewed_by, reviewed_at, started_at, completed_at, failure_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, applied_action_indexes = excluded.applied_action_indexes,
       reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, completed_at = excluded.completed_at, failure_reason = excluded.failure_reason`,
    agentRunParams(agentRun),
  );
  persistState();
}
