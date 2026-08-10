import type { Issue, IssueLinkType } from './issue';
import type {
  AgentRunId,
  AttachmentId,
  AutomationRuleId,
  CommentId,
  EventId,
  FieldId,
  IssueId,
  LinkId,
  ProjectId,
  SprintId,
  StatusId,
  UserId,
  WorklogId,
  WorkspaceId,
} from './ids';

/**
 * The event log. Every mutation in the system still writes its normal entity record (an
 * `Issue` row stays the source of truth for that issue) — this is event *notification*,
 * not event sourcing. Alongside that write, one {@link EventEnvelope} is appended to the
 * workspace's log. Nothing else reads its state from replaying the log; it exists purely
 * so notifications, automations, and outbound webhooks all have exactly one place to
 * subscribe to "anything that happened."
 */

/**
 * Who or what performed an action.
 *
 * An agent acting shows up here as an ordinary `{ kind: 'user', userId }` — because it is
 * one (see {@link UserKind} in user.ts). There is no `kind: 'agent'` case: telling an
 * agent's actions apart from a human's, if a consumer cares, is a join to `User.kind`, not
 * a branch here. `kind: 'automation'` stays distinct because an `AutomationRule` is not a
 * user at all.
 */
export type ActorRef =
  | { kind: 'user'; userId: UserId }
  | { kind: 'automation'; ruleId: AutomationRuleId }
  /** Migrations, imports, scheduled jobs not attributable to one rule. */
  | { kind: 'system' };

export type EntityType = 'issue' | 'comment' | 'sprint' | 'project' | 'automationRule' | 'agent' | 'agentRun';

/** The primary entity an event is about, denormalized onto the envelope for cheap filtering. */
export interface EntityRef {
  type: EntityType;
  id: string;
}

/**
 * Discriminated by `type`. Add a case here whenever a new user-visible action should be
 * notifiable, automatable, or shippable to a webhook — that string is exactly what every
 * `EventSubscription`'s `eventFilter` matches on (e.g. `"issue.statusChanged"`).
 */
export type EventPayload =
  /**
   * Carries the full initial snapshot, not just the id — unlike most events here, this one
   * has to be self-sufficient: the state-database projector (server/src/projector.ts) has
   * nothing else to originate the row from. The log stays the single write path into the
   * database; that only works if creation events carry what creation needs.
   */
  | { type: 'issue.created'; issueId: IssueId; issue: Issue }
  | { type: 'issue.statusChanged'; issueId: IssueId; fromStatusId: StatusId; toStatusId: StatusId }
  | { type: 'issue.fieldChanged'; issueId: IssueId; fieldId: FieldId; fromValue: unknown; toValue: unknown }
  | { type: 'issue.assigned'; issueId: IssueId; fromUserId?: UserId; toUserId?: UserId }
  | { type: 'issue.linked'; issueId: IssueId; linkId: LinkId; linkedIssueId: IssueId; linkType: IssueLinkType }
  | { type: 'issue.unlinked'; issueId: IssueId; linkId: LinkId }
  | { type: 'issue.sprintChanged'; issueId: IssueId; fromSprintId?: SprintId; toSprintId?: SprintId }
  | { type: 'issue.deleted'; issueId: IssueId }
  /**
   * Catch-all for built-in property edits that don't warrant their own case (title,
   * description, priority, story points, labels, components, fix versions, due date,
   * estimates). `issue.fieldChanged` stays reserved for *custom* field values
   * ({@link FieldValue}) — this is for the fixed {@link Issue} shape instead.
   */
  | { type: 'issue.updated'; issueId: IssueId; changes: Record<string, unknown> }
  | { type: 'issue.watcherAdded'; issueId: IssueId; userId: UserId }
  | { type: 'issue.watcherRemoved'; issueId: IssueId; userId: UserId }
  | { type: 'issue.worklogAdded'; issueId: IssueId; worklogId: WorklogId; authorId: UserId; timeSpentSeconds: number; note?: string }
  | {
      type: 'issue.attachmentAdded';
      issueId: IssueId;
      attachmentId: AttachmentId;
      uploadedBy: UserId;
      fileName: string;
      url: string;
      mimeType: string;
      sizeBytes: number;
    }
  | { type: 'comment.created'; commentId: CommentId; issueId: IssueId; authorId: UserId; body: string; parentCommentId?: CommentId }
  | { type: 'comment.edited'; commentId: CommentId; issueId: IssueId; body: string }
  | { type: 'sprint.started'; sprintId: SprintId }
  | { type: 'sprint.completed'; sprintId: SprintId }
  | { type: 'project.created'; projectId: ProjectId }
  /**
   * Automation actions themselves emit events, carrying the event that triggered them —
   * so a chain of automations reacting to each other stays traceable instead of opaque,
   * and rule authors can guard against loops by inspecting ancestry.
   */
  | { type: 'automationRule.executed'; ruleId: AutomationRuleId; triggeringEventId: EventId }
  /**
   * A "manually trigger this agent" button in the UI is not a separate code path — it is
   * exactly this: one more event appended to the same log, which the agent's own
   * `eventFilter` (`Agent extends EventSubscription`, agent.ts) is subscribed to like any other.
   */
  | { type: 'agent.manuallyTriggered'; agentUserId: UserId; triggeredBy: UserId }
  /**
   * Fired when a run lands in `'awaitingApproval'` — the thing a reviewer's subscription
   * actually matches on. Deliberately carries no status/detail: a consumer that wants more
   * looks up the `AgentRun` by id rather than the event duplicating its state.
   */
  | { type: 'agent.runAwaitingApproval'; runId: AgentRunId; agentUserId: UserId }
  /**
   * A human's approve/reject decision is itself an event, the same way everything else a
   * user does to an issue is — not a side-channel write invisible to the log.
   */
  | { type: 'agent.runApproved'; runId: AgentRunId; agentUserId: UserId; reviewedBy: UserId }
  | { type: 'agent.runRejected'; runId: AgentRunId; agentUserId: UserId; reviewedBy: UserId }
  | { type: 'agent.runCompleted'; runId: AgentRunId; agentUserId: UserId };

export type EventType = EventPayload['type'];

/** One entry in the append-only event log. */
export interface EventEnvelope {
  id: EventId;
  workspaceId: WorkspaceId;
  /** Monotonic per workspace — the ordering guarantee "a single log" implies. */
  sequence: number;
  occurredAt: string;
  actor: ActorRef;
  /** Denormalized primary entity, so consumers can filter without inspecting payload. */
  subject: EntityRef;
  payload: EventPayload;
}
