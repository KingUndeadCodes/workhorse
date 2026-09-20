/**
 * Wires every repository and service into a single set of singletons. Repositories/services
 * are constructor-injected classes, not free functions — see repositories/ and services/.
 * `initContainer()` must run after `initDatabases()` (the Kysely instance it hands out isn't
 * ready before then); routes only touch these bindings from inside request handlers, which
 * always run after boot completes, so the `let`-and-fill-in-later shape here is safe — same
 * pattern `db/core.ts` already uses for `db`/`stateDb`.
 */
import { db } from './db/core';
import { AgentRepository } from './repositories/AgentRepository';
import { AgentRunRepository } from './repositories/AgentRunRepository';
import { AutomationRepository } from './repositories/AutomationRepository';
import { CatalogRepository } from './repositories/CatalogRepository';
import { GitRepoLinkRepository } from './repositories/GitRepoLinkRepository';
import { IssueRepository } from './repositories/IssueRepository';
import { NotificationRepository } from './repositories/NotificationRepository';
import { PlanningRepository } from './repositories/PlanningRepository';
import { ProjectRepository } from './repositories/ProjectRepository';
import { UserRepository } from './repositories/UserRepository';
import { WebhookDeliveryRepository } from './repositories/WebhookDeliveryRepository';
import { WebhookRepository } from './repositories/WebhookRepository';
import { WorkflowRepository } from './repositories/WorkflowRepository';
import { WorkspaceRepository } from './repositories/WorkspaceRepository';
import { AgentRuntimeRegistry } from './services/AgentRuntime';
import { AuditService } from './services/AuditService';
import { EventEngine } from './services/EventEngine';
import { EventProjector } from './services/EventProjector';
import { GitProviderRegistry } from './services/GitProvider';
import { localGitProvider } from './services/LocalGitProvider';
import { OllamaAgentRuntime } from './services/OllamaAgentRuntime';
import { StatsService } from './services/StatsService';

export let workspaceRepo: WorkspaceRepository;
export let userRepo: UserRepository;
export let agentRepo: AgentRepository;
export let agentRunRepo: AgentRunRepository;
export let workflowRepo: WorkflowRepository;
export let catalogRepo: CatalogRepository;
export let planningRepo: PlanningRepository;
export let automationRepo: AutomationRepository;
export let webhookRepo: WebhookRepository;
export let issueRepo: IssueRepository;
export let notificationRepo: NotificationRepository;
export let webhookDeliveryRepo: WebhookDeliveryRepository;
export let gitRepoLinkRepo: GitRepoLinkRepository;
export let projectRepo: ProjectRepository;

export let projector: EventProjector;
export let engine: EventEngine;
export let auditService: AuditService;
export let statsService: StatsService;
/**
 * Every supported git host, keyed by `GitRepoLink.provider` — see services/GitProvider.ts.
 * `'local'` (services/LocalGitProvider.ts, shells out to the server's own `git` binary) is
 * registered directly below. A hosted git host (GitHub, GitLab, ...) is added the same way: a
 * new `GitProvider` implementation, registered here — routes/projects.ts and routes/issues.ts
 * only ever resolve through this registry, never a concrete provider directly.
 */
export let gitProviders: GitProviderRegistry;
/**
 * Every LLM backend an `Agent` can run on, keyed by `Agent.runtime` — see
 * services/AgentRuntime.ts. `'ollama'` (a local Ollama server, no hosted-provider dependency)
 * is registered directly below since agents already need to work out of the box. A cloud
 * backend like Anthropic is meant to arrive later the same way — a new `AgentRuntime`
 * implementation registered here, not a change to `EventEngine`, which never imports any model
 * SDK directly.
 */
export let agentRuntimes: AgentRuntimeRegistry;

export function initContainer(): void {
  workspaceRepo = new WorkspaceRepository(db);
  userRepo = new UserRepository(db);
  agentRepo = new AgentRepository(db);
  agentRunRepo = new AgentRunRepository(db);
  workflowRepo = new WorkflowRepository(db);
  catalogRepo = new CatalogRepository(db);
  planningRepo = new PlanningRepository(db);
  automationRepo = new AutomationRepository(db);
  webhookRepo = new WebhookRepository(db);
  issueRepo = new IssueRepository(db);
  notificationRepo = new NotificationRepository(db);
  webhookDeliveryRepo = new WebhookDeliveryRepository(db);
  gitRepoLinkRepo = new GitRepoLinkRepository(db);
  projectRepo = new ProjectRepository(db);

  agentRuntimes = new AgentRuntimeRegistry();
  agentRuntimes.register(new OllamaAgentRuntime());
  gitProviders = new GitProviderRegistry();
  gitProviders.register(localGitProvider);

  projector = new EventProjector(issueRepo, agentRunRepo, planningRepo);
  engine = new EventEngine(
    workspaceRepo, issueRepo, agentRepo, agentRunRepo, automationRepo, webhookRepo, catalogRepo, workflowRepo, userRepo,
    projector, projectRepo, agentRuntimes, gitRepoLinkRepo, gitProviders, notificationRepo, webhookDeliveryRepo,
  );
  auditService = new AuditService(workspaceRepo, issueRepo);
  statsService = new StatsService(workspaceRepo, issueRepo);
}
