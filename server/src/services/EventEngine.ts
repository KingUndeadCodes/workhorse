import { createHmac, randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ActorRef,
  Agent,
  AgentRun,
  AutomationAction,
  AutomationCondition,
  EntityRef,
  EventEnvelope,
  EventPayload,
  EventType,
  FieldValue,
  Issue,
} from '../domain';
import { appendEvent as appendEventToLog, getEventById } from '../eventLog';
import type { AgentRepository } from '../repositories/AgentRepository';
import type { AgentRunRepository } from '../repositories/AgentRunRepository';
import type { AutomationRepository } from '../repositories/AutomationRepository';
import type { CatalogRepository } from '../repositories/CatalogRepository';
import type { IssueRepository } from '../repositories/IssueRepository';
import type { UserRepository } from '../repositories/UserRepository';
import type { WebhookRepository } from '../repositories/WebhookRepository';
import type { WorkflowRepository } from '../repositories/WorkflowRepository';
import type { WorkspaceRepository } from '../repositories/WorkspaceRepository';
import type { EventProjector } from './EventProjector';

/** Lazily constructed — reads `ANTHROPIC_API_KEY` at call time, not at module load, so tests
 * and environments without a key don't crash just by importing this file. */
let anthropicClient: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

/** One Anthropic tool definition per {@link AutomationAction} variant — the agent's entire
 * vocabulary for acting on an issue is this closed set, never an open-ended shell/code tool. */
const ACTION_TOOLS: Record<AutomationAction['type'], Anthropic.Tool> = {
  transitionStatus: {
    name: 'transitionStatus',
    description: "Move the issue to a different workflow status. Only use a status id from the list of valid statuses given below.",
    input_schema: { type: 'object', properties: { toStatusId: { type: 'string' } }, required: ['toStatusId'] },
  },
  assignTo: {
    name: 'assignTo',
    description: 'Assign the issue to a user. Only use a user id from the list of workspace users given below.',
    input_schema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
  },
  addComment: {
    name: 'addComment',
    description: 'Post a comment on the issue, visible to everyone watching it.',
    input_schema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
  },
  setField: {
    name: 'setField',
    description: 'Set the value of a custom field on the issue. Only use a field id from the list of valid fields given below.',
    input_schema: { type: 'object', properties: { fieldId: { type: 'string' }, value: {} }, required: ['fieldId', 'value'] },
  },
};

function matchesFilter(filter: EventType[] | '*', type: EventType): boolean {
  return filter === '*' || filter.includes(type);
}

function evaluateCondition(condition: AutomationCondition, issue: Issue): boolean {
  const value = (issue as unknown as Record<string, unknown>)[condition.field];
  switch (condition.op) {
    case '=':
      return value === condition.value;
    case '!=':
      return value !== condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(value);
    case 'notIn':
      return Array.isArray(condition.value) && !condition.value.includes(value);
    case '>':
      return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
    case '<':
      return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;
    case 'contains':
      return Array.isArray(value) && value.includes(condition.value);
    case 'isEmpty':
      return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
    default:
      return false;
  }
}

/**
 * Reacts to events after they land in the log: runs automations, runs agents, and
 * dispatches webhooks. This is the part of the architecture that makes the event log more
 * than an audit trail. Everything it needs — issues, agents, rules, webhooks, the
 * projector — is constructor-injected, so a test can swap in fakes without touching real state.
 *
 * Deliberately non-recursive: side-effect events constructed here go through
 * {@link EventEngine.writeEvent} (append + project) but not back through
 * {@link EventEngine.emitEvent} — so a comment posted by an automation does not itself
 * re-trigger this engine. Full multi-hop chaining is a real gap, but the alternative — every
 * action able to trigger further actions with no cycle detection — is a worse failure mode
 * for a prototype to ship with.
 */
export class EventEngine {
  constructor(
    private readonly workspace: WorkspaceRepository,
    private readonly issues: IssueRepository,
    private readonly agents: AgentRepository,
    private readonly agentRuns: AgentRunRepository,
    private readonly automations: AutomationRepository,
    private readonly webhooks: WebhookRepository,
    private readonly catalog: CatalogRepository,
    private readonly workflow: WorkflowRepository,
    private readonly users: UserRepository,
    private readonly projector: EventProjector,
  ) {}

  /** The entry point every route should use to record something that happened. */
  async emitEvent(entry: { actor: ActorRef; subject: EntityRef; payload: EventPayload }): Promise<EventEnvelope> {
    const event = await this.writeEvent(entry);
    await this.runAutomations(event);
    await this.runAgents(event);
    await this.dispatchWebhooks(event);
    return event;
  }

  /** Resolves an `awaitingApproval` run: approving executes its proposed actions, rejecting discards them. */
  async resolveAgentRun(runId: string, decision: 'approved' | 'rejected', reviewedBy: string): Promise<AgentRun | undefined> {
    const run = await this.agentRuns.get(runId);
    if (!run || run.status !== 'awaitingApproval') return undefined;

    run.reviewedBy = reviewedBy;
    run.reviewedAt = new Date().toISOString();
    await this.writeEvent({
      actor: { kind: 'user', userId: reviewedBy },
      subject: { type: 'agentRun', id: run.id },
      payload:
        decision === 'approved'
          ? { type: 'agent.runApproved', runId: run.id, agentUserId: run.agentUserId, reviewedBy }
          : { type: 'agent.runRejected', runId: run.id, agentUserId: run.agentUserId, reviewedBy },
    });

    if (decision === 'rejected') {
      run.status = 'rejected';
      run.completedAt = new Date().toISOString();
      await this.projector.upsertAgentRun(run);
      return run;
    }

    const triggeringEvent = getEventById(run.triggeringEventId);
    const issue = triggeringEvent?.subject.type === 'issue' ? await this.issues.get(triggeringEvent.subject.id) : undefined;
    if (issue) {
      await this.executeAgentRun(run, issue);
    } else {
      run.status = 'failed';
      run.failureReason = 'Could not resolve the issue this run was about.';
      run.completedAt = new Date().toISOString();
      await this.projector.upsertAgentRun(run);
    }
    return run;
  }

  /**
   * Manually fires an agent, per its own listening protocol: appends an
   * `agent.manuallyTriggered` event exactly like any other, then — if an issue was given —
   * runs that one agent's decision logic against it directly, bypassing its `eventFilter`.
   */
  async triggerAgentManually(agentUserId: string, triggeredBy: string, issueId?: string): Promise<{ event: EventEnvelope; run?: AgentRun }> {
    const agent = await this.agents.get(agentUserId);
    if (!agent) throw new Error('Agent not found');

    const issue = issueId ? await this.issues.get(issueId) : undefined;
    if (issueId && issue && issue.agentAssignments?.[agentUserId] === undefined) {
      throw new Error('Attach this agent to the issue (choose who it acts on behalf of) before triggering it');
    }

    const subject: EntityRef = issueId ? { type: 'issue', id: issueId } : { type: 'agent', id: agentUserId };
    const event = await this.writeEvent({
      actor: { kind: 'user', userId: triggeredBy },
      subject,
      payload: { type: 'agent.manuallyTriggered', agentUserId, triggeredBy },
    });

    let run: AgentRun | undefined;
    if (issue && (await this.withinBudget(agent))) run = await this.startAgentRun(agent, issue, event.id);
    return { event, run };
  }

  /** Executes every proposed action on a run and marks it applied. Public: also called after approval. */
  async executeAgentRun(run: AgentRun, issue: Issue): Promise<void> {
    const actor: ActorRef = { kind: 'user', userId: run.agentUserId, onBehalfOfUserId: issue.agentAssignments?.[run.agentUserId] };
    run.appliedActionIndexes = [];
    for (let i = 0; i < run.proposedActions.length; i++) {
      await this.applyAction(run.proposedActions[i], issue, actor);
      run.appliedActionIndexes.push(i);
    }
    run.status = 'applied';
    run.completedAt = new Date().toISOString();
    await this.projector.upsertAgentRun(run);
    await this.writeEvent({
      actor,
      subject: { type: 'agentRun', id: run.id },
      payload: { type: 'agent.runCompleted', runId: run.id, agentUserId: run.agentUserId },
    });
  }

  /** Appends to the durable log and immediately projects the change into state, without running automations/agents/webhooks against it. */
  private async writeEvent(entry: { actor: ActorRef; subject: EntityRef; payload: EventPayload }): Promise<EventEnvelope> {
    const event = appendEventToLog(entry, `evt_${randomUUID()}`, (await this.workspace.getWorkspace()).id);
    await this.projector.applyEvent(event);
    return event;
  }

  private issueForEvent(event: EventEnvelope): Promise<Issue | undefined> {
    if (event.subject.type !== 'issue') return Promise.resolve(undefined);
    return this.issues.get(event.subject.id);
  }

  private async applyAction(action: AutomationAction, issue: Issue, actor: ActorRef): Promise<void> {
    switch (action.type) {
      case 'transitionStatus': {
        if (issue.statusId === action.toStatusId) return;
        await this.writeEvent({
          actor,
          subject: { type: 'issue', id: issue.id },
          payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: issue.statusId, toStatusId: action.toStatusId },
        });
        return;
      }
      case 'assignTo': {
        if (issue.assigneeIds.includes(action.userId)) return;
        // Assignees are humans only — an agent (or an automation rule) proposing this action
        // may not assign another agent. Attaching an agent to an issue only happens through
        // the explicit on-behalf-of flow (POST /issues/:id/agents), never through automation.
        const target = await this.users.getById(action.userId);
        if (!target || target.kind === 'agent') return;
        await this.writeEvent({
          actor,
          subject: { type: 'issue', id: issue.id },
          payload: { type: 'issue.assigneesChanged', issueId: issue.id, fromUserIds: issue.assigneeIds, toUserIds: [...issue.assigneeIds, action.userId] },
        });
        return;
      }
      case 'addComment': {
        // AutomationRule isn't a User (see ActorRef in events.ts), so a rule-authored comment
        // is attributed to the project lead — the closest thing to "whoever's responsible for
        // this happening" without inventing a fake account. Falls back to 'system' if the
        // project has no lead assigned yet. Agent-authored comments don't hit this branch:
        // agents ARE users, so `actor.kind === 'user'` already holds for them.
        const authorId = actor.kind === 'user' ? actor.userId : ((await this.workspace.getProject()).leadId ?? 'system');
        const onBehalfOfUserId = actor.kind === 'user' ? actor.onBehalfOfUserId : undefined;
        const commentId = `cmt_${randomUUID()}`;
        await this.writeEvent({
          actor,
          subject: { type: 'comment', id: commentId },
          payload: { type: 'comment.created', commentId, issueId: issue.id, authorId, onBehalfOfUserId, body: action.body },
        });
        return;
      }
      case 'setField': {
        // AutomationAction.value is `unknown` — an automation rule isn't type-checked against
        // the FieldDefinition it targets, so the cast here is a deliberate trust boundary.
        const value = action.value as FieldValue['value'];
        const fromValue = issue.fieldValues.find((f) => f.fieldId === action.fieldId)?.value ?? null;
        await this.writeEvent({
          actor,
          subject: { type: 'issue', id: issue.id },
          payload: { type: 'issue.fieldChanged', issueId: issue.id, fieldId: action.fieldId, fromValue, toValue: value },
        });
        return;
      }
    }
  }

  private async runAutomations(event: EventEnvelope): Promise<void> {
    const issue = await this.issueForEvent(event);
    if (!issue) return;
    for (const rule of await this.automations.list()) {
      if (!rule.enabled) continue;
      if (!matchesFilter(rule.eventFilter, event.payload.type)) continue;
      if (!rule.conditions.every((c) => evaluateCondition(c, issue))) continue;

      const actor: ActorRef = { kind: 'automation', ruleId: rule.id };
      for (const action of rule.actions) await this.applyAction(action, issue, actor);
      await this.writeEvent({
        actor,
        subject: { type: 'automationRule', id: rule.id },
        payload: { type: 'automationRule.executed', ruleId: rule.id, triggeringEventId: event.id },
      });
    }
  }

  private async withinBudget(agent: Agent): Promise<boolean> {
    const { budget } = agent;
    const runsForAgent = (await this.agentRuns.list()).filter((r) => r.agentUserId === agent.userId);
    const now = Date.now();
    if (budget.maxRunsPerHour !== undefined) {
      const hourAgo = now - 60 * 60 * 1000;
      if (runsForAgent.filter((r) => new Date(r.startedAt).getTime() >= hourAgo).length >= budget.maxRunsPerHour) return false;
    }
    if (budget.maxRunsPerDay !== undefined) {
      const dayAgo = now - 24 * 60 * 60 * 1000;
      if (runsForAgent.filter((r) => new Date(r.startedAt).getTime() >= dayAgo).length >= budget.maxRunsPerDay) return false;
    }
    if (budget.maxSpendPerDay !== undefined) {
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const tokensToday = runsForAgent
        .filter((r) => new Date(r.startedAt).getTime() >= dayAgo)
        .reduce((sum, r) => sum + (r.tokenUsage ?? 0), 0);
      if (tokensToday >= budget.maxSpendPerDay) return false;
    }
    return true;
  }

  /**
   * Real decision-making: one non-streaming Anthropic Messages API call, tools restricted to
   * `agent.allowedActionTypes`, single-shot per call (no in-call tool-use loop — if the model
   * doesn't call a tool on the first response, it proposed nothing this turn). Agents are
   * meant to work a ticket over its whole life, not react once and vanish: an agent stays
   * attached to an issue (via `agentAssignments`) across every matching event, and each call
   * here is reminded of the comment thread and its own prior turns on this same issue, so it
   * can pick up where it left off instead of re-deciding from a blank slate every time. The
   * model sees that history plus the agent's own `description` as its only instructions; it
   * never sees or touches anything outside the closed {@link AutomationAction} vocabulary.
   */
  private async decideAgentActions(agent: Agent, issue: Issue): Promise<{ actions: AutomationAction[]; rationale: string; tokenUsage: number }> {
    const tools = agent.allowedActionTypes.map((type) => ACTION_TOOLS[type]);
    if (tools.length === 0) return { actions: [], rationale: 'This agent has no allowed action types.', tokenUsage: 0 };

    const [statuses, users, fields, comments, priorRuns] = await Promise.all([
      this.workflow.getWorkflow().then((w) => w.statuses),
      this.users.list(),
      this.catalog.listFieldDefinitions(),
      this.issues.listCommentsFor(issue.id),
      this.agentRuns.list().then((runs) => runs.filter((r) => r.issueId === issue.id && r.agentUserId === agent.userId)),
    ]);

    const system = [
      `You are "${agent.name}", an AI agent embedded in an issue tracker. ${agent.description ?? ''}`.trim(),
      "You're being triggered by one event on the issue below, but you stay attached to this issue for its whole life — " +
        "you may be called again as it changes. Treat the comment thread and your own prior turns (given below) as work " +
        "already in progress: build on it rather than starting over or repeating an action you've already taken.",
      'Decide whether to take any action right now. Only propose actions using the tools provided — you have no other way to affect the system. If nothing is warranted this turn, do not call any tool.',
      `Valid statuses (for transitionStatus): ${statuses.map((s) => `${s.id} ("${s.name}")`).join(', ') || 'none'}`,
      `Valid users (for assignTo — humans only, agents can't be assignees): ${users.filter((u) => u.kind !== 'agent').map((u) => `${u.id} ("${u.displayName}")`).join(', ') || 'none'}`,
      `Valid fields (for setField): ${fields.map((f) => `${f.id} ("${f.name}", type ${f.type})`).join(', ') || 'none'}`,
    ].join('\n');

    const recentComments = comments
      .slice(-8)
      .map((c) => `  - ${users.find((u) => u.id === c.authorId)?.displayName ?? c.authorId}: ${c.body.plainText}`)
      .join('\n');
    const recentTurns = priorRuns
      .slice(-5)
      .map((r) => `  - [${r.status}] ${r.rationale ?? '(no rationale recorded)'}`)
      .join('\n');

    const userMessage = [
      `Issue: ${issue.title}`,
      issue.description ? `Description: ${issue.description}` : undefined,
      `Current status: ${issue.statusId}`,
      `Type: ${issue.issueTypeId}`,
      `Assignees: ${issue.assigneeIds.length ? issue.assigneeIds.join(', ') : 'unassigned'}`,
      recentComments ? `Recent comments (oldest first):\n${recentComments}` : 'No comments yet.',
      recentTurns ? `Your prior turns on this issue (oldest first):\n${recentTurns}` : "You haven't acted on this issue before.",
    ]
      .filter(Boolean)
      .join('\n');

    let response: Anthropic.Message;
    try {
      response = await anthropic().messages.create({
        model: agent.model,
        max_tokens: 1024,
        system,
        tools,
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: userMessage }],
      });
    } catch (err) {
      throw new Error(`Agent model call failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const tokenUsage = response.usage.input_tokens + response.usage.output_tokens;
    const actions: AutomationAction[] = [];
    let rationale = '';
    for (const block of response.content) {
      if (block.type === 'text') rationale += block.text;
      else if (block.type === 'tool_use') actions.push({ type: block.name as AutomationAction['type'], ...(block.input as object) } as AutomationAction);
    }
    if (!rationale) rationale = actions.length > 0 ? `Proposed ${actions.length} action(s).` : 'No action proposed for this event.';
    return { actions, rationale, tokenUsage };
  }

  /** Creates and (unless approval is required) immediately executes an {@link AgentRun}. */
  private async startAgentRun(agent: Agent, issue: Issue, triggeringEventId: string): Promise<AgentRun> {
    let decided: { actions: AutomationAction[]; rationale: string; tokenUsage: number };
    try {
      decided = await this.decideAgentActions(agent, issue);
    } catch (err) {
      const run: AgentRun = {
        id: `run_${randomUUID()}`,
        agentUserId: agent.userId,
        triggeringEventId,
        issueId: issue.id,
        status: 'failed',
        proposedActions: [],
        failureReason: err instanceof Error ? err.message : String(err),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      await this.projector.upsertAgentRun(run);
      return run;
    }
    const { actions, rationale, tokenUsage } = decided;
    const bounded = actions.filter((a) => agent.allowedActionTypes.includes(a.type)).slice(0, agent.budget.maxActionsPerRun ?? actions.length);

    const policy = agent.approvalPolicy;
    const requiresApproval =
      bounded.length > 0 &&
      (policy.mode === 'requireApprovalForAll' || (policy.mode === 'requireApprovalFor' && bounded.some((a) => policy.actionTypes.includes(a.type))));

    const run: AgentRun = {
      id: `run_${randomUUID()}`,
      agentUserId: agent.userId,
      triggeringEventId,
      issueId: issue.id,
      status: bounded.length === 0 ? 'applied' : requiresApproval ? 'awaitingApproval' : 'pending',
      proposedActions: bounded,
      rationale,
      tokenUsage,
      startedAt: new Date().toISOString(),
      completedAt: bounded.length === 0 ? new Date().toISOString() : undefined,
    };
    await this.projector.upsertAgentRun(run);

    if (bounded.length === 0) {
      // Nothing proposed — run is already 'applied' with zero actions, nothing further to do.
    } else if (requiresApproval) {
      await this.writeEvent({
        actor: { kind: 'user', userId: agent.userId },
        subject: { type: 'agentRun', id: run.id },
        payload: { type: 'agent.runAwaitingApproval', runId: run.id, agentUserId: agent.userId },
      });
    } else {
      await this.executeAgentRun(run, issue);
    }
    return run;
  }

  private async runAgents(event: EventEnvelope): Promise<void> {
    const issue = await this.issueForEvent(event);
    if (!issue) return;
    for (const agent of await this.agents.list()) {
      if (!agent.enabled) continue;
      // An agent only reacts to an issue it's been explicitly attached to (on behalf of one
      // of that issue's assignees) — this is what makes "always acts on behalf of an assigned
      // user" an enforced invariant rather than best-effort: a broad `eventFilter` no longer
      // lets an agent auto-react to issues nobody put it on.
      if (issue.agentAssignments?.[agent.userId] === undefined) continue;
      if (agent.ignoreSelfTriggeredEvents && event.actor.kind === 'user' && event.actor.userId === agent.userId) continue;
      if (!matchesFilter(agent.eventFilter, event.payload.type)) continue;
      if (!(await this.withinBudget(agent))) continue;
      await this.startAgentRun(agent, issue, event.id);
    }
  }

  /** Fire-and-forget delivery to every enabled, matching webhook — failures are logged, never thrown. */
  private async dispatchWebhooks(event: EventEnvelope): Promise<void> {
    for (const hook of await this.webhooks.list()) {
      if (!hook.enabled) continue;
      if (!matchesFilter(hook.eventFilter, event.payload.type)) continue;
      const payload = JSON.stringify(event);
      const signature = createHmac('sha256', hook.secret).update(payload).digest('hex');
      fetch(hook.targetUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-anvil-signature': signature },
        body: payload,
      }).catch((err) => {
        console.error(`Webhook delivery to ${hook.targetUrl} failed:`, err instanceof Error ? err.message : err);
      });
    }
  }
}
