import { createHmac, randomUUID } from 'node:crypto';
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
} from './domain';
import { appendEvent as appendEventToLog, getEventById } from './eventLog';
import { applyEvent, upsertAgentRun } from './projector';
import { getAgent, getAgentRun, getIssue, getProject, getWorkspace, listAgentRuns, listAgents, listAutomationRules, listIssueTypes, listWebhookSubscriptions } from './queries';

/**
 * Reacts to events after they land in the log: runs automations, runs agents, and
 * dispatches webhooks. This is the part of the architecture that makes the event log more
 * than an audit trail.
 *
 * Deliberately non-recursive: side-effect events constructed here go through
 * {@link writeEvent} (append + project) but not back through {@link emitEvent} — so a
 * comment posted by an automation does not itself re-trigger this engine. Full multi-hop
 * chaining (an automation reacting to another automation's output) is a real gap, but the
 * alternative — every action able to trigger further actions with no cycle detection — is
 * a worse failure mode for a prototype to ship with.
 */

function matchesFilter(filter: EventType[] | '*', type: EventType): boolean {
  return filter === '*' || filter.includes(type);
}

async function issueForEvent(event: EventEnvelope): Promise<Issue | undefined> {
  if (event.subject.type !== 'issue') return undefined;
  return getIssue(event.subject.id);
}

/** Appends to the durable log and immediately projects the change into `state.db`, without running automations/agents/webhooks against it. */
async function writeEvent(entry: { actor: ActorRef; subject: EntityRef; payload: EventPayload }): Promise<EventEnvelope> {
  const event = appendEventToLog(entry, `evt_${randomUUID()}`, (await getWorkspace()).id);
  await applyEvent(event);
  return event;
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

/** Applies one action to its target issue by writing the event that describes the change — the projector, not this function, touches `state.db`. */
async function applyAction(action: AutomationAction, issue: Issue, actor: ActorRef): Promise<void> {
  switch (action.type) {
    case 'transitionStatus': {
      if (issue.statusId === action.toStatusId) return;
      await writeEvent({
        actor,
        subject: { type: 'issue', id: issue.id },
        payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: issue.statusId, toStatusId: action.toStatusId },
      });
      return;
    }
    case 'assignTo': {
      await writeEvent({
        actor,
        subject: { type: 'issue', id: issue.id },
        payload: { type: 'issue.assigned', issueId: issue.id, fromUserId: issue.assigneeId, toUserId: action.userId },
      });
      return;
    }
    case 'addComment': {
      // AutomationRule isn't a User (see ActorRef in events.ts), so a rule-authored comment
      // is attributed to the project lead — the closest thing to "whoever's responsible for
      // this happening" without inventing a fake account. An Agent-authored comment doesn't
      // hit this branch: agents ARE users, so `actor.kind === 'user'` already holds for them.
      // Falls back to 'system' if the project has no lead assigned yet.
      const authorId = actor.kind === 'user' ? actor.userId : ((await getProject()).leadId ?? 'system');
      const commentId = `cmt_${randomUUID()}`;
      await writeEvent({
        actor,
        subject: { type: 'comment', id: commentId },
        payload: { type: 'comment.created', commentId, issueId: issue.id, authorId, body: action.body },
      });
      return;
    }
    case 'setField': {
      // AutomationAction.value is `unknown` — an automation rule isn't type-checked against
      // the FieldDefinition it targets, so the cast here is a deliberate trust boundary,
      // same as the server trusts client-supplied field values elsewhere.
      const value = action.value as FieldValue['value'];
      const fromValue = issue.fieldValues.find((f) => f.fieldId === action.fieldId)?.value ?? null;
      await writeEvent({
        actor,
        subject: { type: 'issue', id: issue.id },
        payload: { type: 'issue.fieldChanged', issueId: issue.id, fieldId: action.fieldId, fromValue, toValue: value },
      });
      return;
    }
  }
}

async function runAutomations(event: EventEnvelope): Promise<void> {
  const issue = await issueForEvent(event);
  if (!issue) return;
  for (const rule of await listAutomationRules()) {
    if (!rule.enabled) continue;
    if (!matchesFilter(rule.eventFilter, event.payload.type)) continue;
    if (!rule.conditions.every((c) => evaluateCondition(c, issue))) continue;

    const actor: ActorRef = { kind: 'automation', ruleId: rule.id };
    for (const action of rule.actions) await applyAction(action, issue, actor);
    await writeEvent({
      actor,
      subject: { type: 'automationRule', id: rule.id },
      payload: { type: 'automationRule.executed', ruleId: rule.id, triggeringEventId: event.id },
    });
  }
}

async function withinBudget(agent: Agent): Promise<boolean> {
  const { budget } = agent;
  const runsForAgent = (await listAgentRuns()).filter((r) => r.agentUserId === agent.userId);
  const now = Date.now();
  if (budget.maxRunsPerHour !== undefined) {
    const hourAgo = now - 60 * 60 * 1000;
    if (runsForAgent.filter((r) => new Date(r.startedAt).getTime() >= hourAgo).length >= budget.maxRunsPerHour) return false;
  }
  if (budget.maxRunsPerDay !== undefined) {
    const dayAgo = now - 24 * 60 * 60 * 1000;
    if (runsForAgent.filter((r) => new Date(r.startedAt).getTime() >= dayAgo).length >= budget.maxRunsPerDay) return false;
  }
  return true;
  // maxSpendPerDay isn't enforced here — there's no real per-call cost to meter without an
  // actual model behind decideAgentActions below.
}

/**
 * Stands in for a real LLM call: a small deterministic heuristic so the whole agent
 * pipeline (trigger -> proposed actions -> approval -> execution) can be exercised end to
 * end without wiring up an actual model. A real agent implementation replaces only this
 * function's body with a model call — budget, approval, and execution around it stay the same.
 */
async function decideAgentActions(agent: Agent, issue: Issue): Promise<{ actions: AutomationAction[]; rationale: string }> {
  const bugTypeId = (await listIssueTypes()).find((t) => t.name === 'Bug')?.id;
  if (issue.issueTypeId === bugTypeId) {
    return {
      actions: [{ type: 'addComment', body: `Thanks for filing "${issue.title}" — flagged for triage.` }],
      rationale: `New issue is a Bug ("${issue.title}"), matched the triage heuristic.`,
    };
  }
  return { actions: [], rationale: 'No triage action applies to this issue type.' };
}

/** Creates and (unless approval is required) immediately executes an {@link AgentRun}. */
async function startAgentRun(agent: Agent, issue: Issue, triggeringEventId: string): Promise<AgentRun> {
  const { actions, rationale } = await decideAgentActions(agent, issue);
  const bounded = actions.filter((a) => agent.allowedActionTypes.includes(a.type)).slice(0, agent.budget.maxActionsPerRun ?? actions.length);

  const policy = agent.approvalPolicy;
  const requiresApproval =
    bounded.length > 0 &&
    (policy.mode === 'requireApprovalForAll' || (policy.mode === 'requireApprovalFor' && bounded.some((a) => policy.actionTypes.includes(a.type))));

  const run: AgentRun = {
    id: `run_${randomUUID()}`,
    agentUserId: agent.userId,
    triggeringEventId,
    status: bounded.length === 0 ? 'applied' : requiresApproval ? 'awaitingApproval' : 'pending',
    proposedActions: bounded,
    rationale,
    startedAt: new Date().toISOString(),
    completedAt: bounded.length === 0 ? new Date().toISOString() : undefined,
  };
  upsertAgentRun(run);

  if (bounded.length === 0) {
    // Nothing proposed — run is already 'applied' with zero actions, nothing further to do.
  } else if (requiresApproval) {
    await writeEvent({
      actor: { kind: 'user', userId: agent.userId },
      subject: { type: 'agentRun', id: run.id },
      payload: { type: 'agent.runAwaitingApproval', runId: run.id, agentUserId: agent.userId },
    });
  } else {
    await executeAgentRun(run, issue);
  }
  return run;
}

/** Executes every proposed action on a run and marks it applied. */
export async function executeAgentRun(run: AgentRun, issue: Issue): Promise<void> {
  const actor: ActorRef = { kind: 'user', userId: run.agentUserId };
  run.appliedActionIndexes = [];
  for (let i = 0; i < run.proposedActions.length; i++) {
    await applyAction(run.proposedActions[i], issue, actor);
    run.appliedActionIndexes?.push(i);
  }
  run.status = 'applied';
  run.completedAt = new Date().toISOString();
  upsertAgentRun(run);
  await writeEvent({
    actor,
    subject: { type: 'agentRun', id: run.id },
    payload: { type: 'agent.runCompleted', runId: run.id, agentUserId: run.agentUserId },
  });
}

async function runAgents(event: EventEnvelope): Promise<void> {
  const issue = await issueForEvent(event);
  if (!issue) return;
  for (const agent of await listAgents()) {
    if (!agent.enabled) continue;
    if (agent.ignoreSelfTriggeredEvents && event.actor.kind === 'user' && event.actor.userId === agent.userId) continue;
    if (!matchesFilter(agent.eventFilter, event.payload.type)) continue;
    if (!(await withinBudget(agent))) continue;
    await startAgentRun(agent, issue, event.id);
  }
}

/**
 * Resolves an `awaitingApproval` run: approving executes its proposed actions, rejecting
 * discards them. Both are themselves events, per the "a human's decision is an event too" design.
 */
export async function resolveAgentRun(runId: string, decision: 'approved' | 'rejected', reviewedBy: string): Promise<AgentRun | undefined> {
  const run = await getAgentRun(runId);
  if (!run || run.status !== 'awaitingApproval') return undefined;

  run.reviewedBy = reviewedBy;
  run.reviewedAt = new Date().toISOString();
  await writeEvent({
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
    upsertAgentRun(run);
    return run;
  }

  const triggeringEvent = getEventById(run.triggeringEventId);
  const issue = triggeringEvent?.subject.type === 'issue' ? await getIssue(triggeringEvent.subject.id) : undefined;
  if (issue) {
    await executeAgentRun(run, issue);
  } else {
    run.status = 'failed';
    run.failureReason = 'Could not resolve the issue this run was about.';
    run.completedAt = new Date().toISOString();
    upsertAgentRun(run);
  }
  return run;
}

/**
 * Manually fires an agent, per its own listening protocol: this appends an
 * `agent.manuallyTriggered` event exactly like any other, then — if an issue was given —
 * runs that one agent's decision logic against it directly, bypassing its `eventFilter`
 * (that filter governs automatic triggering; an explicit manual trigger is the whole point
 * of overriding it).
 */
export async function triggerAgentManually(agentUserId: string, triggeredBy: string, issueId?: string): Promise<{ event: EventEnvelope; run?: AgentRun }> {
  const agent = await getAgent(agentUserId);
  if (!agent) throw new Error('Agent not found');

  const subject: EntityRef = issueId ? { type: 'issue', id: issueId } : { type: 'agent', id: agentUserId };
  const event = await writeEvent({
    actor: { kind: 'user', userId: triggeredBy },
    subject,
    payload: { type: 'agent.manuallyTriggered', agentUserId, triggeredBy },
  });

  const issue = issueId ? await getIssue(issueId) : undefined;
  let run: AgentRun | undefined;
  if (issue && (await withinBudget(agent))) run = await startAgentRun(agent, issue, event.id);
  return { event, run };
}

/** Fire-and-forget delivery to every enabled, matching webhook — failures are logged, never thrown. */
async function dispatchWebhooks(event: EventEnvelope): Promise<void> {
  for (const hook of await listWebhookSubscriptions()) {
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

/**
 * The entry point every route should use to record something that happened: appends the
 * event to the log, projects it into `state.db`, then runs automations, agents, and
 * webhook delivery against it.
 */
export async function emitEvent(entry: { actor: ActorRef; subject: EntityRef; payload: EventPayload }): Promise<EventEnvelope> {
  const event = await writeEvent(entry);
  await runAutomations(event);
  await runAgents(event);
  await dispatchWebhooks(event);
  return event;
}
