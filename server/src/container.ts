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
import { IssueRepository } from './repositories/IssueRepository';
import { PlanningRepository } from './repositories/PlanningRepository';
import { UserRepository } from './repositories/UserRepository';
import { WebhookRepository } from './repositories/WebhookRepository';
import { WorkflowRepository } from './repositories/WorkflowRepository';
import { WorkspaceRepository } from './repositories/WorkspaceRepository';
import { AuditService } from './services/AuditService';
import { EventEngine } from './services/EventEngine';
import { EventProjector } from './services/EventProjector';

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

export let projector: EventProjector;
export let engine: EventEngine;
export let auditService: AuditService;

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

  projector = new EventProjector(issueRepo, agentRunRepo, planningRepo);
  engine = new EventEngine(workspaceRepo, issueRepo, agentRepo, agentRunRepo, automationRepo, webhookRepo, catalogRepo, projector);
  auditService = new AuditService(workspaceRepo, issueRepo);
}
