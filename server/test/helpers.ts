import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../src/db/types';
import { AgentRepository } from '../src/repositories/AgentRepository';
import { AgentRunRepository } from '../src/repositories/AgentRunRepository';
import { AutomationRepository } from '../src/repositories/AutomationRepository';
import { CatalogRepository } from '../src/repositories/CatalogRepository';
import { GitRepoLinkRepository } from '../src/repositories/GitRepoLinkRepository';
import { UserGitConnectionRepository } from '../src/repositories/UserGitConnectionRepository';
import { IssueRepository } from '../src/repositories/IssueRepository';
import { NotificationRepository } from '../src/repositories/NotificationRepository';
import { PlanningRepository } from '../src/repositories/PlanningRepository';
import { ProjectRepository } from '../src/repositories/ProjectRepository';
import { UserRepository } from '../src/repositories/UserRepository';
import { WebhookDeliveryRepository } from '../src/repositories/WebhookDeliveryRepository';
import { WebhookRepository } from '../src/repositories/WebhookRepository';
import { WorkflowRepository } from '../src/repositories/WorkflowRepository';
import { WorkspaceRepository } from '../src/repositories/WorkspaceRepository';
import { AgentRuntimeRegistry } from '../src/services/AgentRuntime';
import { EventEngine } from '../src/services/EventEngine';
import { EventProjector } from '../src/services/EventProjector';
import type { AgentRuntime, AgentRuntimeDecision } from '../src/services/AgentRuntime';
import { GitAuthResolver } from '../src/services/GitAuthResolver';
import { GitProviderRegistry } from '../src/services/GitProvider';
import type { GitProvider } from '../src/services/GitProvider';
import type { Agent, AgentApprovalPolicy, AutomationAction, AutomationCondition, AutomationRule, EventType, Issue, User } from '../src/domain';

/**
 * Wires the same repositories + EventEngine that `container.ts`'s `initContainer()` does,
 * against a test-local `db` (see test/setup.ts's mock of db/core). Hand-rolled rather than
 * calling `initContainer()` itself, so a test doesn't depend on `OllamaAgentRuntime`'s
 * constructor being side-effect-free — nothing here ever registers a real agent runtime or
 * git provider, since notification/webhook dispatch never reaches either.
 */
export function createTestEngine(db: Kysely<DB>) {
  const workspaceRepo = new WorkspaceRepository(db);
  const issueRepo = new IssueRepository(db);
  const agentRepo = new AgentRepository(db);
  const agentRunRepo = new AgentRunRepository(db);
  const automationRepo = new AutomationRepository(db);
  const webhookRepo = new WebhookRepository(db);
  const catalogRepo = new CatalogRepository(db);
  const workflowRepo = new WorkflowRepository(db);
  const userRepo = new UserRepository(db);
  const planningRepo = new PlanningRepository(db);
  const projectRepo = new ProjectRepository(db);
  const gitRepoLinkRepo = new GitRepoLinkRepository(db);
  const userGitConnectionRepo = new UserGitConnectionRepository(db);
  const gitAuthResolver = new GitAuthResolver(userGitConnectionRepo);
  const notificationRepo = new NotificationRepository(db);
  const webhookDeliveryRepo = new WebhookDeliveryRepository(db);

  const projector = new EventProjector(issueRepo, agentRunRepo, planningRepo);
  const agentRuntimes = new AgentRuntimeRegistry();
  const gitProviders = new GitProviderRegistry();

  const engine = new EventEngine(
    workspaceRepo, issueRepo, agentRepo, agentRunRepo, automationRepo, webhookRepo, catalogRepo, workflowRepo, userRepo,
    projector, projectRepo, agentRuntimes, gitRepoLinkRepo, gitProviders, notificationRepo, webhookDeliveryRepo, gitAuthResolver,
  );

  return {
    engine, workspaceRepo, issueRepo, userRepo, workflowRepo, notificationRepo, webhookRepo, webhookDeliveryRepo,
    agentRepo, agentRunRepo, automationRepo, projectRepo, catalogRepo, gitRepoLinkRepo, userGitConnectionRepo, agentRuntimes, gitProviders,
  };
}

/** Required before anything reaches `EventEngine.writeEvent` — it calls `workspace.getWorkspace()`
 *  unconditionally, which throws on an empty `workspace` table (see WorkspaceRepository). */
export async function seedWorkspace(db: Kysely<DB>): Promise<string> {
  const id = `ws_${randomUUID()}`;
  await db.insertInto('workspace').values({ id, name: 'Test Workspace', slug: 'test', created_at: new Date().toISOString() }).execute();
  return id;
}

/** Only `kind: 'human'` users are eligible notification recipients — see EventEngine.notifyRecipients. */
export async function seedHumanUser(userRepo: UserRepository, email: string, displayName: string): Promise<User> {
  return userRepo.createHuman(email, displayName, 'test-hash');
}

export async function seedIssue(issueRepo: IssueRepository, overrides: Partial<Issue> & { reporterId: string }): Promise<Issue> {
  const now = new Date().toISOString();
  const issue: Issue = {
    id: `issue_${randomUUID()}`,
    key: `TEST-${Math.floor(Math.random() * 100_000)}`,
    projectId: 'proj_test',
    issueTypeId: 'type_test',
    statusId: 'st_todo',
    title: 'Test issue',
    priority: 'medium',
    assigneeIds: [],
    labelIds: [],
    componentIds: [],
    fixVersionIds: [],
    loggedSeconds: 0,
    fieldValues: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await issueRepo.insert(issue);
  return issue;
}

/**
 * A minimal but valid workflow: a `todo`-category status and a `done`-category status, wired
 * up so `EventEngine.classifyStatusTransition('st_todo', 'st_done')` resolves to `'resolved'`
 * — needed by any test exercising the statusChanged→resolved notification-dedup path.
 */
export async function seedWorkflow(db: Kysely<DB>): Promise<void> {
  const workflowId = `wf_${randomUUID()}`;
  const todoCategoryId = `cat_${randomUUID()}`;
  const doneCategoryId = `cat_${randomUUID()}`;
  await db.insertInto('workflow').values({ id: workflowId, name: 'Test Workflow', initial_status_id: 'st_todo' }).execute();
  await db
    .insertInto('status_categories')
    .values([
      { id: todoCategoryId, workspace_id: null, name: 'To Do', type: 'todo', color: null, sort_order: 0 },
      { id: doneCategoryId, workspace_id: null, name: 'Done', type: 'done', color: null, sort_order: 1 },
    ])
    .execute();
  await db
    .insertInto('workflow_statuses')
    .values([
      { id: 'st_todo', workflow_id: workflowId, name: 'To Do', category_id: todoCategoryId, color: null },
      { id: 'st_done', workflow_id: workflowId, name: 'Done', category_id: doneCategoryId, color: null },
    ])
    .execute();
}

/** Creates the `kind: 'agent'` User row an `Agent` record hangs off, plus the `Agent` record itself. */
export async function seedAgent(
  userRepo: UserRepository,
  agentRepo: AgentRepository,
  overrides: Partial<Agent> & { userId?: string } = {},
): Promise<Agent> {
  const userId = overrides.userId ?? `u_agent_${randomUUID()}`;
  await userRepo.createAgentUser(userId, `${userId}@agents.local`, overrides.name ?? 'Test Agent', new Date().toISOString());
  const agent: Agent = {
    workspaceId: 'ws_test',
    projectId: null,
    name: 'Test Agent',
    enabled: true,
    runtime: 'fake',
    model: 'fake-model',
    contextScope: 'ticket',
    eventFilter: '*',
    allowedActionTypes: ['addComment'],
    approvalPolicy: { mode: 'autoApplyAll' },
    budget: {},
    ignoreSelfTriggeredEvents: true,
    createdAt: new Date().toISOString(),
    ...overrides,
    userId,
  };
  await agentRepo.create(agent);
  return agent;
}

export async function seedAutomationRule(automationRepo: AutomationRepository, overrides: Partial<AutomationRule> = {}): Promise<AutomationRule> {
  const rule: AutomationRule = {
    id: `rule_${randomUUID()}`,
    projectId: null,
    name: 'Test Rule',
    enabled: true,
    eventFilter: ['issue.created'] as EventType[],
    conditions: [] as AutomationCondition[],
    actions: [] as AutomationAction[],
    ...overrides,
  };
  return automationRepo.create(rule);
}

/** A `GitProvider` whose behavior a test controls directly — no network, no real host. */
export function fakeGitProvider(overrides: Partial<GitProvider> = {}): GitProvider {
  return {
    id: 'fake',
    verifyAccess: async () => {},
    createBranch: async ({ newBranchName }) => ({ url: `fake://branch/${newBranchName}` }),
    readFile: async ({ path }) => ({ content: `contents of ${path}` }),
    writeFile: async ({ path, branch }) => ({ url: `fake://file/${branch}/${path}` }),
    ...overrides,
  };
}

/** An `AgentRuntime` that returns a fixed decision every call — no LLM, no network. */
export function fakeAgentRuntime(decide: (opts: { model: string; system: string; userMessage: string }) => AgentRuntimeDecision): AgentRuntime {
  return { id: 'fake', decide: async (opts) => decide(opts) };
}

/** Convenience: a fake runtime that always proposes the same fixed tool calls, regardless of what it's asked. */
export function fixedDecisionRuntime(toolCalls: AgentRuntimeDecision['toolCalls'], text = ''): AgentRuntime {
  return fakeAgentRuntime(() => ({ toolCalls, text, tokenUsage: 1 }));
}

export function approvalPolicy(mode: AgentApprovalPolicy['mode'], actionTypes?: AutomationAction['type'][]): AgentApprovalPolicy {
  if (mode === 'requireApprovalFor') return { mode, actionTypes: actionTypes ?? [] };
  return { mode };
}

/**
 * Polls `fn` until it returns a non-empty array or `timeout` elapses. Needed because
 * `EventEngine.dispatchWebhooks` fires each delivery with `void` — deliberately not
 * awaited (see its doc comment) — so a webhook test can't just await `emitEvent()` and
 * expect the resulting WebhookDelivery row to already exist.
 */
export async function waitFor<T>(fn: () => Promise<T[]>, { timeout = 500, interval = 5 }: { timeout?: number; interval?: number } = {}): Promise<T[]> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const result = await fn();
    if (result.length > 0 || Date.now() > deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
