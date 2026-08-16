import { persistState } from '../db/core';
import type { AgentRun, EventEnvelope, FieldValue } from '../domain';
import type { AgentRunRepository } from '../repositories/AgentRunRepository';
import type { IssueRepository } from '../repositories/IssueRepository';
import type { PlanningRepository } from '../repositories/PlanningRepository';

/**
 * Projects durable-log events into the operational tables `IssueRepository` owns. This is
 * the only place events turn into state-DB writes — routes append to the log via
 * {@link EventEngine}, never write these tables directly. Catalog/reference data (labels,
 * components, workflow config, rule/agent/webhook *definitions*) is simple CRUD written
 * straight from its repository instead — definitions aren't log-worthy activity.
 */
export class EventProjector {
  constructor(
    private readonly issues: IssueRepository,
    private readonly agentRuns: AgentRunRepository,
    private readonly planning: PlanningRepository,
  ) {}

  async applyEvent(event: EventEnvelope): Promise<void> {
    const { payload } = event;
    switch (payload.type) {
      case 'issue.created':
        await this.issues.insert(payload.issue);
        break;
      case 'issue.statusChanged':
        await this.issues.updateStatus(payload.issueId, payload.toStatusId, event.occurredAt);
        break;
      case 'issue.assigneesChanged':
        await this.issues.updateAssignees(payload.issueId, payload.toUserIds, event.occurredAt);
        break;
      case 'issue.agentAssigned':
        await this.issues.assignAgent(payload.issueId, payload.agentUserId, payload.onBehalfOfUserId, event.occurredAt);
        break;
      case 'issue.agentUnassigned':
        await this.issues.unassignAgent(payload.issueId, payload.agentUserId, event.occurredAt);
        break;
      case 'issue.sprintChanged':
        await this.issues.updateSprint(payload.issueId, payload.toSprintId, event.occurredAt);
        break;
      case 'issue.updated':
        await this.issues.updateFields(payload.issueId, payload.changes, event.occurredAt);
        break;
      case 'issue.priorityChanged':
        await this.issues.updateFields(payload.issueId, { priority: payload.toPriority }, event.occurredAt);
        break;
      case 'issue.labelsChanged':
        await this.issues.updateFields(payload.issueId, { labelIds: payload.toLabelIds }, event.occurredAt);
        break;
      case 'issue.dueDateChanged':
        await this.issues.updateFields(payload.issueId, { dueDate: payload.toDueDate }, event.occurredAt);
        break;
      case 'issue.resolved':
      case 'issue.reopened':
        // Notification-only — issue.statusChanged (always emitted alongside) already wrote the actual statusId/updated_at.
        break;
      case 'issue.fieldChanged':
        await this.issues.setFieldValue(payload.issueId, payload.fieldId, payload.toValue as FieldValue['value'], event.occurredAt);
        break;
      case 'issue.deleted':
        await this.issues.deleteCascade(payload.issueId);
        break;
      case 'issue.linked': {
        const createdBy = event.actor.kind === 'user' ? event.actor.userId : 'u_leon';
        const link = this.issues.buildLink(payload.linkId, payload.issueId, payload.linkedIssueId, payload.linkType, event.occurredAt, createdBy);
        await this.issues.insertLink(link);
        break;
      }
      case 'issue.unlinked':
        await this.issues.deleteLink(payload.linkId);
        break;
      case 'issue.worklogAdded':
        await this.issues.insertWorklog(
          { id: payload.worklogId, issueId: payload.issueId, authorId: payload.authorId, timeSpentSeconds: payload.timeSpentSeconds, startedAt: event.occurredAt, note: payload.note },
          event.occurredAt,
        );
        break;
      case 'issue.attachmentAdded':
        await this.issues.insertAttachment({
          id: payload.attachmentId,
          issueId: payload.issueId,
          uploadedBy: payload.uploadedBy,
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          sizeBytes: payload.sizeBytes,
          url: payload.url,
          createdAt: event.occurredAt,
        });
        break;
      case 'comment.created':
        await this.issues.insertComment({
          id: payload.commentId,
          issueId: payload.issueId,
          authorId: payload.authorId,
          onBehalfOfUserId: payload.onBehalfOfUserId,
          body: { format: 'richtext-v1', content: null, plainText: payload.body },
          createdAt: event.occurredAt,
          parentCommentId: payload.parentCommentId,
        });
        break;
      case 'comment.edited':
        await this.issues.updateComment(payload.commentId, payload.body, event.occurredAt);
        break;
      case 'comment.deleted':
        await this.issues.deleteComment(payload.commentId);
        break;
      case 'issue.branchCreated':
        await this.issues.insertBranch({
          id: payload.branchId,
          issueId: payload.issueId,
          gitRepoLinkId: payload.gitRepoLinkId,
          name: payload.name,
          url: payload.url,
          createdAt: event.occurredAt,
          createdBy: event.actor.kind === 'user' ? event.actor.userId : 'u_leon',
        });
        break;
      case 'issue.branchDeleted':
        await this.issues.deleteBranchFor(payload.issueId);
        break;
      case 'sprint.started':
        await this.planning.startSprint(payload.sprintId);
        break;
      case 'sprint.completed':
        await this.planning.completeSprint(payload.sprintId, event.occurredAt);
        break;
      default:
        // Config-mutation echoes, agent/automation bookkeeping events, and anything else
        // without a direct state effect — nothing for the projector to do.
        break;
    }
    persistState();
  }

  async upsertAgentRun(run: AgentRun): Promise<void> {
    await this.agentRuns.upsert(run);
  }
}
