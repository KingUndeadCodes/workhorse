import { createHmac, randomUUID } from 'node:crypto';
import type {
  ActorRef,
  Agent,
  AgentRun,
  AutomationAction,
  AutomationCondition,
  Comment,
  EntityRef,
  EventEnvelope,
  EventPayload,
  EventType,
  FieldValue,
  Issue,
} from '../domain';
import { parseMentionedUserIds } from '../domain';
import { appendEvent as appendEventToLog, getEventById } from '../eventLog';
import type { AgentRepository } from '../repositories/AgentRepository';
import type { AgentRunRepository } from '../repositories/AgentRunRepository';
import type { AutomationRepository } from '../repositories/AutomationRepository';
import type { CatalogRepository } from '../repositories/CatalogRepository';
import type { GitRepoLinkRepository } from '../repositories/GitRepoLinkRepository';
import type { IssueRepository } from '../repositories/IssueRepository';
import type { ProjectRepository } from '../repositories/ProjectRepository';
import type { UserRepository } from '../repositories/UserRepository';
import type { WebhookRepository } from '../repositories/WebhookRepository';
import type { WorkflowRepository } from '../repositories/WorkflowRepository';
import type { WorkspaceRepository } from '../repositories/WorkspaceRepository';
import { broadcastEvent } from '../ws';
import type { AgentRuntimeRegistry, AgentRuntimeTool } from './AgentRuntime';
import type { EventProjector } from './EventProjector';
import type { GitProviderRegistry } from './GitProvider';

/** One tool definition per {@link AutomationAction} variant — the agent's entire vocabulary
 * for acting on an issue is this closed set, never an open-ended shell/code tool. Shape is
 * provider-neutral ({@link AgentRuntimeTool}, not any SDK's own tool type) since whichever
 * `AgentRuntime` ends up handling a given agent is resolved at call time, not known here. */
const ACTION_TOOLS: Record<AutomationAction['type'], AgentRuntimeTool> = {
  transitionStatus: {
    name: 'transitionStatus',
    description: "Move the issue to a different workflow status. Only use a status id from the list of valid statuses given below.",
    inputSchema: { type: 'object', properties: { toStatusId: { type: 'string' } }, required: ['toStatusId'] },
  },
  assignTo: {
    name: 'assignTo',
    description: 'Assign the issue to a user. Only use a user id from the list of workspace users given below.',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
  },
  addComment: {
    name: 'addComment',
    description:
      "Post a comment on the issue, visible to everyone watching it. `body` IS the deliverable — if asked for code, write the actual code directly in `body` as a markdown code block; if asked a question, put the real answer in `body`. Never write a comment that just claims something was done elsewhere ('I've added a script') without the thing itself included in this same body.",
    inputSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
  },
  setField: {
    name: 'setField',
    description: 'Set the value of a custom field on the issue. Only use a field id from the list of valid fields given below.',
    inputSchema: { type: 'object', properties: { fieldId: { type: 'string' }, value: {} }, required: ['fieldId', 'value'] },
  },
  readRepoFile: {
    name: 'readRepoFile',
    description:
      "Read one file's content from the project's linked git repository (its default branch). Only works if the project has a repo linked — if it doesn't, this will fail. Use this before writing to an existing file, so you edit its real content instead of guessing.",
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  writeRepoFile: {
    name: 'writeRepoFile',
    description:
      "Create or overwrite one file in the project's linked git repository, committed to a new branch you name — never to the repository's main/default branch directly. `content` must be the file's complete new content, not a diff or a description of the change. A human reviews and merges the branch themselves; nothing here touches anyone's local working copy.",
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' }, branchName: { type: 'string' }, commitMessage: { type: 'string' } },
      required: ['path', 'content', 'branchName'],
    },
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

/** The `issueId` field on whichever `EventPayload` variants carry one — see `issueForEvent`. */
function issueIdFromPayload(payload: EventPayload): string | undefined {
  return 'issueId' in payload && typeof payload.issueId === 'string' ? payload.issueId : undefined;
}

/**
 * The root comment id of the thread an event belongs to, or `undefined` if the event wasn't
 * itself a comment (nothing to scope to). Mirrors the same `comment.created` / `comment.mentioned`
 * check `applyAction`'s `addComment` case uses to decide what to reply to — walks `parentCommentId`
 * up to the top so replies-to-replies still resolve to the one thread they're all part of.
 */
function threadRootCommentId(event: EventEnvelope | undefined, comments: Comment[]): string | undefined {
  const payload = event?.payload;
  const commentId = payload?.type === 'comment.created' || payload?.type === 'comment.mentioned' ? payload.commentId : undefined;
  if (!commentId) return undefined;
  const byId = new Map(comments.map((c) => [c.id, c]));
  let current = byId.get(commentId);
  if (!current) return commentId; // comment since deleted — treat its own id as the root
  const seen = new Set<string>();
  while (current.parentCommentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentCommentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

/** Every comment in the thread rooted at `rootId` — the root itself plus every reply nested under it, at any depth. */
function commentsInThread(rootId: string, comments: Comment[]): Comment[] {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of comments) {
      if (c.parentCommentId && ids.has(c.parentCommentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return comments.filter((c) => ids.has(c.id));
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
    private readonly projects: ProjectRepository,
    private readonly agentRuntimes: AgentRuntimeRegistry,
    private readonly gitRepoLinks: GitRepoLinkRepository,
    private readonly gitProviders: GitProviderRegistry,
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
    if (issueId && issue && !issue.agentAssignments?.includes(agentUserId)) {
      throw new Error('Attach this agent to the issue before triggering it');
    }

    const subject: EntityRef = issueId ? { type: 'issue', id: issueId } : { type: 'agent', id: agentUserId };
    const event = await this.writeEvent({
      actor: { kind: 'user', userId: triggeredBy },
      subject,
      payload: { type: 'agent.manuallyTriggered', agentUserId, triggeredBy },
    });

    let run: AgentRun | undefined;
    if (issue && (await this.withinBudget(agent))) run = await this.startAgentRun(agent, issue, event);
    return { event, run };
  }

  /** Executes every proposed action on a run and marks it applied (or failed, if one throws). Public: also called after approval. */
  async executeAgentRun(run: AgentRun, issue: Issue): Promise<void> {
    const actor: ActorRef = { kind: 'user', userId: run.agentUserId };
    // Looked up here rather than threaded in by every caller — whatever event triggered this
    // run is what an `addComment` action should reply to, if it was itself a comment (see
    // applyAction's addComment case). resolveAgentRun/startAgentRun both already know this run's
    // triggeringEventId; re-fetching it here keeps that "what to reply to" decision in one place.
    const triggeringEvent = getEventById(run.triggeringEventId);
    run.appliedActionIndexes = [];
    try {
      for (let i = 0; i < run.proposedActions.length; i++) {
        // readRepoFile/writeRepoFile are the first actions here that can genuinely throw
        // (no linked repo, a git error) — every other action type only ever checks simple
        // conditions and returns early, never throws. Catching per-run rather than letting it
        // propagate matters specifically because of that: this method runs synchronously
        // inside whatever route's `emitEvent` call triggered the agent (e.g. posting a
        // comment), and an uncaught throw here would 500 that unrelated request instead of
        // just marking this run failed.
        await this.applyAction(run.proposedActions[i], issue, actor, triggeringEvent);
        run.appliedActionIndexes.push(i);
      }
    } catch (err) {
      run.status = 'failed';
      run.failureReason = err instanceof Error ? err.message : String(err);
      run.completedAt = new Date().toISOString();
      await this.projector.upsertAgentRun(run);
      return;
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
    // Every event, whether it came from a route or (like an automation/agent's own actions)
    // from inside this class, goes out to connected browser tabs the same way — this is the
    // one place both paths converge, so live updates can't miss one or the other.
    broadcastEvent(event);
    return event;
  }

  /**
   * The issue an event is "about," for automations/agents to react against — not simply
   * `event.subject`, which for a sub-entity event (a comment, an attachment, a branch) points
   * at that sub-entity, not the issue it hangs off. Almost every such payload carries its own
   * `issueId` field precisely so this can be recovered; only `subject.type === 'issue'` events
   * (status changes, assignee changes, ...) need the subject itself. Falling back to `subject`
   * only, as this used to, silently meant no automation or agent could ever react to a comment
   * event — `runAgents`/`runAutomations` would resolve `issue` as `undefined` and bail before
   * checking a single rule or agent.
   */
  private issueForEvent(event: EventEnvelope): Promise<Issue | undefined> {
    const issueId = event.subject.type === 'issue' ? event.subject.id : issueIdFromPayload(event.payload);
    return issueId ? this.issues.get(issueId) : Promise.resolve(undefined);
  }

  /**
   * Whether a status transition crosses into or out of a `'done'`-type {@link StatusCategory}
   * — see domain/events.ts's `issue.resolved`/`issue.reopened` doc comment for why this is
   * split out from the plain `issue.statusChanged` every transition already emits. Public so
   * routes/issues.ts's direct PATCH /issues/:id can classify a transition the same way
   * `applyAction`'s `transitionStatus` case does below, instead of duplicating this logic.
   */
  async classifyStatusTransition(fromStatusId: string, toStatusId: string): Promise<'resolved' | 'reopened' | undefined> {
    const [workflow, categories] = await Promise.all([this.workflow.getWorkflow(), this.workflow.listStatusCategories()]);
    const categoryIdByStatusId = new Map(workflow.statuses.map((s) => [s.id, s.categoryId]));
    const typeByCategoryId = new Map(categories.map((c) => [c.id, c.type]));
    const fromIsDone = typeByCategoryId.get(categoryIdByStatusId.get(fromStatusId) ?? '') === 'done';
    const toIsDone = typeByCategoryId.get(categoryIdByStatusId.get(toStatusId) ?? '') === 'done';
    if (!fromIsDone && toIsDone) return 'resolved';
    if (fromIsDone && !toIsDone) return 'reopened';
    return undefined;
  }

  /** `triggeringEvent`, if given, is what an `addComment` action replies to when it was itself a comment — see that case below. Every other action ignores it. */
  private async applyAction(action: AutomationAction, issue: Issue, actor: ActorRef, triggeringEvent?: EventEnvelope): Promise<void> {
    switch (action.type) {
      case 'transitionStatus': {
        if (issue.statusId === action.toStatusId) return;
        await this.writeEvent({
          actor,
          subject: { type: 'issue', id: issue.id },
          payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: issue.statusId, toStatusId: action.toStatusId },
        });
        const transition = await this.classifyStatusTransition(issue.statusId, action.toStatusId);
        if (transition) {
          await this.writeEvent({
            actor,
            subject: { type: 'issue', id: issue.id },
            payload: { type: `issue.${transition}`, issueId: issue.id, statusId: action.toStatusId },
          });
        }
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
        const authorId = actor.kind === 'user' ? actor.userId : ((await this.projects.getProjectById(issue.projectId))?.leadId ?? 'system');
        const commentId = `cmt_${randomUUID()}`;
        // If a rule/agent was triggered by a comment (a mention, a new top-level comment),
        // thread its reply under that comment rather than posting a new top-level one — the
        // model/rule never has to know or decide this; it's inferred from what set it off.
        const triggeringPayload = triggeringEvent?.payload;
        const parentCommentId =
          triggeringPayload?.type === 'comment.created' || triggeringPayload?.type === 'comment.mentioned' ? triggeringPayload.commentId : undefined;
        await this.writeEvent({
          actor,
          subject: { type: 'comment', id: commentId },
          payload: { type: 'comment.created', commentId, issueId: issue.id, authorId, body: action.body, parentCommentId },
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
      case 'readRepoFile': {
        const link = await this.gitRepoLinks.getForProject(issue.projectId);
        if (!link) throw new Error('This project has no linked git repository');
        const provider = this.gitProviders.resolve(link.provider);
        const { content } = await provider.readFile({ owner: link.owner, repo: link.repo, token: link.token, branch: link.defaultBranch, path: action.path });
        await this.writeEvent({
          actor,
          subject: { type: 'issue', id: issue.id },
          payload: { type: 'issue.repoFileRead', issueId: issue.id, gitRepoLinkId: link.id, path: action.path, content },
        });
        return;
      }
      case 'writeRepoFile': {
        const link = await this.gitRepoLinks.getForProject(issue.projectId);
        if (!link) throw new Error('This project has no linked git repository');
        const provider = this.gitProviders.resolve(link.provider);
        const opts = { owner: link.owner, repo: link.repo, token: link.token };
        // verifyAccess against the target branch doubles as an existence check — if it throws,
        // the branch doesn't exist yet and gets created off the repo's default branch first
        // (the same starting point issue branch creation uses). Never writes to the default
        // branch itself; see the `writeRepoFile` domain doc comment for why.
        const branchExists = await provider
          .verifyAccess({ ...opts, branch: action.branchName })
          .then(() => true)
          .catch(() => false);
        if (!branchExists) await provider.createBranch({ ...opts, fromBranch: link.defaultBranch, newBranchName: action.branchName });
        const result = await provider.writeFile({
          ...opts,
          branch: action.branchName,
          path: action.path,
          content: action.content,
          commitMessage: action.commitMessage?.trim() || `Update ${action.path}`,
        });
        await this.writeEvent({
          actor,
          subject: { type: 'issue', id: issue.id },
          payload: { type: 'issue.repoFileWritten', issueId: issue.id, gitRepoLinkId: link.id, path: action.path, branchName: action.branchName, url: result.url },
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
      for (const action of rule.actions) await this.applyAction(action, issue, actor, event);
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
   * Real decision-making: one non-streaming call to the agent's resolved {@link AgentRuntime}, tools restricted to
   * `agent.allowedActionTypes`, single-shot per call (no in-call tool-use loop — if the model
   * doesn't call a tool on the first response, it proposed nothing this turn). Agents are
   * meant to work a ticket over its whole life, not react once and vanish: an agent stays
   * attached to an issue (via `agentAssignments`) across every matching event, and each call
   * here is reminded of the comment thread and its own prior turns on this same issue, so it
   * can pick up where it left off instead of re-deciding from a blank slate every time. The
   * model sees that history plus the agent's own `description` as its only instructions; it
   * never sees or touches anything outside the closed {@link AutomationAction} vocabulary.
   *
   * When the triggering event is itself a comment (a new reply or a mention), the "comment
   * thread" and "prior turns" context below are scoped to that comment's thread alone — its
   * root comment plus every reply nested under it, and only this agent's prior runs that were
   * themselves triggered from within that same thread — rather than the whole issue's history.
   * Separate threads on one issue are usually separate conversations; without this, an agent
   * replying in thread A would see (and get confused by) unrelated activity from thread B. A
   * non-comment trigger (issue created, status changed, manually triggered with no thread to
   * anchor to) has no thread to scope to, so it falls back to the prior issue-wide behavior.
   */
  private async decideAgentActions(
    agent: Agent,
    issue: Issue,
    triggeringEvent?: EventEnvelope,
  ): Promise<{ actions: AutomationAction[]; rationale: string; tokenUsage: number }> {
    const tools = agent.allowedActionTypes.map((type) => ACTION_TOOLS[type]);
    if (tools.length === 0) return { actions: [], rationale: 'This agent has no allowed action types.', tokenUsage: 0 };

    const [statuses, users, fields, allComments, allPriorRuns] = await Promise.all([
      this.workflow.getWorkflow().then((w) => w.statuses),
      this.users.list(),
      this.catalog.listFieldDefinitions(),
      this.issues.listCommentsFor(issue.id),
      this.agentRuns.list().then((runs) => runs.filter((r) => r.issueId === issue.id && r.agentUserId === agent.userId)),
    ]);

    const threadRootId = threadRootCommentId(triggeringEvent, allComments);
    const comments = threadRootId ? commentsInThread(threadRootId, allComments) : allComments;
    const priorRuns = threadRootId
      ? allPriorRuns.filter((r) => threadRootCommentId(getEventById(r.triggeringEventId), allComments) === threadRootId)
      : allPriorRuns;

    const scopeRank: Record<Agent['contextScope'], number> = { thread: 0, ticket: 1, project: 2, workspace: 3 };
    const rank = scopeRank[agent.contextScope] ?? scopeRank.ticket;
    const includeTicket = rank >= scopeRank.ticket;
    const [projectContext, workspaceContext] = await Promise.all([
      rank >= scopeRank.project ? this.buildProjectContext(issue) : Promise.resolve(''),
      rank >= scopeRank.workspace ? this.buildWorkspaceContext() : Promise.resolve(''),
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
      includeTicket ? `Issue: ${issue.title}` : `Issue: ${issue.id}`,
      includeTicket && issue.description ? `Description: ${issue.description}` : undefined,
      includeTicket ? `Current status: ${issue.statusId}` : undefined,
      includeTicket ? `Type: ${issue.issueTypeId}` : undefined,
      includeTicket ? `Assignees: ${issue.assigneeIds.length ? issue.assigneeIds.join(', ') : 'unassigned'}` : undefined,
      recentComments
        ? `${threadRootId ? 'This comment thread' : 'Recent comments'} (oldest first):\n${recentComments}`
        : 'No comments yet.',
      recentTurns
        ? `Your prior turns ${threadRootId ? 'in this thread' : 'on this issue'} (oldest first):\n${recentTurns}`
        : "You haven't acted on this issue before.",
      projectContext || undefined,
      workspaceContext || undefined,
    ]
      .filter(Boolean)
      .join('\n');

    const runtime = this.agentRuntimes.resolve(agent.runtime);
    const decision = await runtime.decide({ model: agent.model, system, userMessage, tools });

    const actions: AutomationAction[] = decision.toolCalls.map((call) => ({ type: call.name as AutomationAction['type'], ...call.input }) as AutomationAction);
    let rationale = decision.text;
    if (!rationale) rationale = actions.length > 0 ? `Proposed ${actions.length} action(s).` : 'No action proposed for this event.';
    return { actions, rationale, tokenUsage: decision.tokenUsage };
  }

  /**
   * `contextScope: 'project'` layer — deliberately thin: the project name plus a bare
   * id/title/status list of the project's other open tickets, no comment bodies or
   * descriptions. Enough for the model to notice "there's a related ticket for this" without
   * pulling in enough text to dilute its focus on the issue actually in front of it.
   */
  private async buildProjectContext(issue: Issue): Promise<string> {
    const project = await this.projects.getProjectById(issue.projectId);
    if (!project) return '';
    const [workflow, categories, projectIssues] = await Promise.all([
      this.workflow.getWorkflow(),
      this.workflow.listStatusCategories(),
      this.issues.list(issue.projectId),
    ]);
    const categoryIdByStatusId = new Map(workflow.statuses.map((s) => [s.id, s.categoryId]));
    const typeByCategoryId = new Map(categories.map((c) => [c.id, c.type]));
    const statusNameById = new Map(workflow.statuses.map((s) => [s.id, s.name]));
    const openSiblings = projectIssues.filter((i) => {
      if (i.id === issue.id) return false;
      const type = typeByCategoryId.get(categoryIdByStatusId.get(i.statusId) ?? '');
      return type === 'todo' || type === 'inProgress';
    });
    const list = openSiblings.map((i) => `  - ${i.id} "${i.title}" [${statusNameById.get(i.statusId) ?? i.statusId}]`).join('\n');
    return [`Project: ${project.name}`, list ? `Other open tickets in this project (oldest first):\n${list}` : 'No other open tickets in this project.'].join(
      '\n',
    );
  }

  /**
   * `contextScope: 'workspace'` layer — the thinnest tier: just the workspace name and which
   * projects exist, no ticket-level detail at all. Only useful for an agent whose job spans
   * the whole workspace (e.g. noticing a ticket belongs in a different project).
   */
  private async buildWorkspaceContext(): Promise<string> {
    const [workspace, projects] = await Promise.all([this.workspace.getWorkspace(), this.projects.listProjects()]);
    const names = projects.map((p) => p.name).join(', ') || 'none';
    return [`Workspace: ${workspace.name}`, `Projects (${projects.length}): ${names}`].join('\n');
  }

  /** Creates and (unless approval is required) immediately executes an {@link AgentRun}. */
  private async startAgentRun(agent: Agent, issue: Issue, triggeringEvent: EventEnvelope): Promise<AgentRun> {
    const triggeringEventId = triggeringEvent.id;
    let decided: { actions: AutomationAction[]; rationale: string; tokenUsage: number };
    try {
      decided = await this.decideAgentActions(agent, issue, triggeringEvent);
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

    // If the triggering comment @-mentions one or more specific agents by name, only those
    // agents are eligible to respond — otherwise every attached agent independently decides
    // whether to react to the same comment, and a comment addressed to one bot (e.g.
    // "@SlurBot ...") gets answered by a different one that merely happens to also be attached
    // to the issue. A comment that mentions no agent (or isn't a comment at all) keeps the
    // broad behavior: any attached, matching agent may react on its own judgment.
    const body = event.payload.type === 'comment.created' || event.payload.type === 'comment.mentioned' || event.payload.type === 'comment.edited' ? event.payload.body : undefined;
    let mentionedAgentIds: Set<string> | undefined;
    if (body !== undefined) {
      const users = await this.users.list();
      const mentioned = parseMentionedUserIds(body, users).filter((uid) => users.find((u) => u.id === uid)?.kind === 'agent');
      if (mentioned.length > 0) mentionedAgentIds = new Set(mentioned);
    }

    for (const agent of await this.agents.list()) {
      if (!agent.enabled) continue;
      // An agent only reacts to an issue it's been explicitly attached to — a broad
      // `eventFilter` alone doesn't let an agent auto-react to issues nobody put it on.
      if (!issue.agentAssignments?.includes(agent.userId)) continue;
      if (mentionedAgentIds && !mentionedAgentIds.has(agent.userId)) continue;
      if (agent.ignoreSelfTriggeredEvents && event.actor.kind === 'user' && event.actor.userId === agent.userId) continue;
      // `comment.mentioned` always accompanies a `comment.created` for the very same comment
      // (see routes/issues.ts, which emits both back-to-back for any comment that @-mentions
      // someone). An agent whose filter includes `comment.created` already gets a run from that
      // sibling event, so honoring `comment.mentioned` here too would post its reply twice.
      // Agents that react *only* to being mentioned (comment.created not in their filter, e.g.
      // one that should stay quiet unless addressed) still need `comment.mentioned` to fire —
      // it's their only trigger for comments at all.
      if (event.payload.type === 'comment.mentioned' && matchesFilter(agent.eventFilter, 'comment.created')) continue;
      if (!matchesFilter(agent.eventFilter, event.payload.type)) continue;
      if (!(await this.withinBudget(agent))) continue;
      await this.startAgentRun(agent, issue, event);
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
