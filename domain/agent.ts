import type { AutomationAction } from './automation';
import type { EventSubscription } from './subscription';
import type { AgentRunId, EventId, IssueId, ProjectId, UserId, WorkspaceId } from './ids';

/**
 * An AI Agent is a {@link User} (`kind: 'agent'` in user.ts) plus this record of what
 * makes it act. It reacts to the same event log everything else does — a "manually
 * trigger this agent" button just appends an `agent.manuallyTriggered` event (events.ts),
 * which is picked up the same way any other trigger is. There is no separate
 * manual-invocation path.
 *
 * Two separate protocols are in play, and only one of them is unique to `Agent`. The
 * listening protocol — which events reach it at all — is {@link EventSubscription}, the
 * same contract `AutomationRule` and `WebhookSubscription` implement. The acting protocol
 * below ({@link allowedActionTypes} / {@link approvalPolicy} / {@link budget}) exists only
 * here (and on `AutomationRule`) because, unlike a `WebhookSubscription`, an agent mutates
 * this system's real state and needs guardrails this system can itself audit and enforce.
 * Whatever satisfies both protocols — which model it runs, how it reasons, what it's built
 * on — is free to do absolutely anything on its own side of that line.
 */
export interface Agent extends EventSubscription {
  /** The `User` row (`kind: 'agent'`) this agent inhabits. */
  userId: UserId;
  workspaceId: WorkspaceId;
  /** `null` = workspace-wide, same scoping `AutomationRule` uses. */
  projectId: ProjectId | null;
  name: string;
  description?: string;
  enabled: boolean;
  /**
   * Which {@link AgentRuntime} (server/src/services/AgentRuntime.ts) executes this agent's
   * decision-making — an id that must match a runtime registered in container.ts, same
   * relationship `GitRepoLink.provider` has to `GitProvider`. Defaults to `'ollama'`, the one
   * runtime this app ships (a local Ollama server — no hosted-provider dependency), at the
   * mapping layer for agents predating this field. A hosted provider like Anthropic is meant
   * to arrive later as a third-party runtime, not something this app bundles.
   */
  runtime: string;
  /** Model id passed to the resolved runtime, e.g. `llama3.1` for the `'ollama'` runtime. */
  model: string;
  /**
   * How much surrounding context this agent's prompt is built from, each tier additive over
   * the last: `'thread'` is just the triggering comment's own thread; `'ticket'` (the default)
   * adds the issue's own title/description/status/type/assignees; `'project'` adds a thin list
   * of other open/in-progress tickets in the same project (id/title/status only, no comment
   * bodies); `'workspace'` adds the workspace name and a project-name/count summary. Defaults
   * to `'ticket'` so existing agents (and new ones left unset) see exactly what they always
   * have — wider scope is opt-in, since it costs more tokens and can dilute the model's focus
   * with unrelated tickets if the agent's task doesn't need it.
   */
  contextScope: AgentContextScope;
  /**
   * Bounds what the agent may ever propose to the same action vocabulary `AutomationRule`
   * uses, rather than "whatever it decides" — caps blast radius and keeps agent-caused
   * writes auditable through the same pipeline as rule-caused writes.
   */
  allowedActionTypes: AutomationAction['type'][];
  approvalPolicy: AgentApprovalPolicy;
  budget: AgentBudget;
  /**
   * Skip events whose actor is this agent's own userId. Without this, an agent that
   * comments on issues would see its own `comment.created` event and could retrigger
   * itself indefinitely.
   */
  ignoreSelfTriggeredEvents: boolean;
  createdAt: string;
}

/** Additive tiers of context an {@link Agent}'s prompt can be built from — see {@link Agent.contextScope}. */
export type AgentContextScope = 'thread' | 'ticket' | 'project' | 'workspace';

/** How much of an {@link Agent}'s proposed actions execute automatically vs. wait for a human. */
export type AgentApprovalPolicy =
  | { mode: 'autoApplyAll' }
  | { mode: 'requireApprovalForAll' }
  /** e.g. auto-apply labeling/triage but hold `transitionStatus` and `assignTo` for a human. */
  | { mode: 'requireApprovalFor'; actionTypes: AutomationAction['type'][] };

/**
 * Rate/cost ceilings for an {@link Agent}. All limits optional; omitted = unlimited. The
 * unit behind `maxSpendPerDay` is workspace-defined (dollars, credits, tokens) — not a
 * domain concern here, just a ceiling.
 */
export interface AgentBudget {
  maxRunsPerHour?: number;
  maxRunsPerDay?: number;
  maxActionsPerRun?: number;
  maxSpendPerDay?: number;
}

export type AgentRunStatus = 'pending' | 'awaitingApproval' | 'applied' | 'rejected' | 'failed';

/**
 * One attempt by an {@link Agent} at reacting to a trigger. This is a full entity rather
 * than just an event row because it has real state to transition through
 * (`pending -> awaitingApproval -> applied/rejected/failed`) — the same reasoning that
 * makes `Comment` a stored entity even though "a comment was created" is also an event.
 */
export interface AgentRun {
  id: AgentRunId;
  agentUserId: UserId;
  /** Includes a manual `agent.manuallyTriggered` event. */
  triggeringEventId: EventId;
  /** The issue this run reacted to — lets the UI show which human the agent was acting on behalf of (via that issue's `agentAssignments`) without re-resolving the triggering event. */
  issueId: IssueId;
  status: AgentRunStatus;
  proposedActions: AutomationAction[];
  /** Subset of {@link proposedActions} actually executed, once resolved. */
  appliedActionIndexes?: number[];
  /** Short explanation of why these actions were proposed — what makes a run debuggable rather than a black box. */
  rationale?: string;
  reviewedBy?: UserId;
  reviewedAt?: string;
  startedAt: string;
  completedAt?: string;
  /** Set when `status === 'failed'`. */
  failureReason?: string;
  /** Input+output tokens billed for the model call that produced this run, if any. */
  tokenUsage?: number;
}
