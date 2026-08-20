/** Entry point: boots both databases, wires the OO container, loads third-party plugins, creates the minimal structural rows if `state.db` is brand new (see seed.ts — no sample content), then serves the Hono app (app.ts) on `PORT`, defaulting to 8787. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { app } from './app';
import { agentRuntimes, gitProviders, initContainer, planningRepo, userRepo, workflowRepo, workspaceRepo } from './container';
import { initDatabases, persistState } from './db/core';
import {
  backfillAgentAssignments,
  backfillAgentRunIssueIds,
  backfillIssueAssignees,
  backfillProjectColors,
  migrateEventsDb,
  migrateStateDb,
} from './db/schema';
import { loadPlugins } from './plugins/loadPlugins';
import { bootstrapDatabase } from './seed';
import { initWebSocketServer } from './ws';

const { isFreshState } = await initDatabases();
migrateStateDb();
migrateEventsDb();
initContainer();

/**
 * Where third-party extensions live — see plugins/README.md and services/GitProvider.ts /
 * services/AgentRuntime.ts for the contract. `PLUGINS_DIR` lets a deployment point at a
 * directory outside this repo entirely (e.g. a separate config volume), matching the
 * `OLLAMA_HOST`/`JWT_SECRET` env-var-override convention used elsewhere.
 */
const pluginsDir = process.env.PLUGINS_DIR?.trim() || join(dirname(fileURLToPath(import.meta.url)), '../../plugins');
await loadPlugins(pluginsDir, {
  registerGitProvider: (p) => gitProviders.register(p),
  registerAgentRuntime: (r) => agentRuntimes.register(r),
});

if (isFreshState) bootstrapDatabase();

/**
 * One-time catch-up for accounts created before workspace membership existed: gives every
 * human user with no `workspace_members` row a role, oldest account first as 'owner' so
 * there's always exactly one owner rather than none. New signups get their row directly in
 * `UserRepository.createHuman`'s caller (see routes/auth.ts) and never hit this path.
 */
async function backfillWorkspaceMembers(): Promise<void> {
  const existingIds = new Set((await workspaceRepo.listMembers()).map((m) => m.userId));
  const missing = (await userRepo.list())
    .filter((u) => u.kind === 'human' && !existingIds.has(u.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (missing.length === 0) return;
  const hasOwner = await workspaceRepo.hasOwner();
  const workspaceId = (await workspaceRepo.getWorkspace()).id;
  for (let i = 0; i < missing.length; i++) {
    const role = !hasOwner && i === 0 ? 'owner' : 'member';
    await workspaceRepo.addMember(workspaceId, missing[i].id, role, missing[i].createdAt);
  }
  persistState();
}
await backfillWorkspaceMembers();

/**
 * One-time catch-up for statuses created before {@link workflowRouter}'s status-creation
 * route started placing new statuses into a matching board column — without this, a status
 * like a custom "In Review" under In Progress exists and can be assigned to an issue, but
 * that issue then has nowhere to render on the Board (see PlanningRepository.addStatusToMatchingColumn).
 */
async function backfillBoardColumns(): Promise<void> {
  const workflow = await workflowRepo.getWorkflow();
  const statusCategoryById = new Map(workflow.statuses.map((s) => [s.id, s.categoryId]));
  for (const status of workflow.statuses) {
    await planningRepo.addStatusToMatchingColumn(status.id, status.categoryId, statusCategoryById);
  }
}
await backfillBoardColumns();
backfillIssueAssignees();
backfillAgentAssignments();
backfillAgentRunIssueIds();
backfillProjectColors();
persistState();

const port = Number(process.env.PORT ?? 8787);

const httpServer = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Workhorse API listening on http://localhost:${info.port}`);
});
initWebSocketServer(httpServer);
