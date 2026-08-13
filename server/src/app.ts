import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAuth } from './auth/middleware';
import {
  agentRepo,
  agentRunRepo,
  auditService,
  automationRepo,
  catalogRepo,
  issueRepo,
  planningRepo,
  userRepo,
  webhookRepo,
  workflowRepo,
  workspaceRepo,
} from './container';
import { getEventsSince } from './eventLog';
import { agentsRouter } from './routes/agents';
import { automationsRouter } from './routes/automations';
import { catalogRouter } from './routes/catalog';
import { meRouter, publicAuthRouter } from './routes/auth';
import { issuesRouter } from './routes/issues';
import { planningRouter } from './routes/planning';
import { webhooksRouter } from './routes/webhooks';
import { workflowRouter } from './routes/workflow';
import { workspaceRouter } from './routes/workspace';

export const app = new Hono();

app.use('*', cors());

// Bearer tokens aren't sent ambiently by the browser the way cookies are, so an unconfigured
// cors() above grants no extra authority to a malicious origin here — no origin allowlist needed.
app.route('/api', publicAuthRouter); // signup, login — public, no token required

app.use('/api/*', requireAuth); // everything below this line requires a valid bearer token

app.route('/api', meRouter); // /api/auth/me

/**
 * GET /api/bootstrap — the entire read model in one call, assembled from the repositories
 * in container.ts. A single-workspace prototype doesn't need a bootstrap endpoint per entity
 * type yet. Splitting this up is the natural move once there's more than one workspace or
 * the payload gets too large to ship on every load.
 */
app.get('/api/bootstrap', async (c) => {
  const [
    workspace, users, workspaceMembers, agents, agentRuns, statusCategories, workflow, project,
    components, versions, issueTypes, labels, fieldDefinitions, sprints, board, savedViews,
    automationRules, webhookSubscriptions, issues, issueLinks, comments, worklogs, attachments,
  ] = await Promise.all([
    workspaceRepo.getWorkspace(), userRepo.list(), workspaceRepo.listMembers(), agentRepo.list(), agentRunRepo.list(),
    workflowRepo.listStatusCategories(), workflowRepo.getWorkflow(), workspaceRepo.getProject(), catalogRepo.listComponents(),
    catalogRepo.listVersions(), catalogRepo.listIssueTypes(), catalogRepo.listLabels(), catalogRepo.listFieldDefinitions(),
    planningRepo.listSprints(), planningRepo.getBoard(), planningRepo.listSavedViews(), automationRepo.list(), webhookRepo.list(),
    issueRepo.list(), issueRepo.listLinks(), issueRepo.listComments(), issueRepo.listWorklogs(),
    issueRepo.listAttachments(),
  ]);
  return c.json({
    workspace, users, workspaceMembers, agents, agentRuns, statusCategories, workflow, project,
    components, versions, issueTypes, labels, fieldDefinitions, sprints, board, savedViews,
    automationRules, webhookSubscriptions, issues, issueLinks, comments, worklogs, attachments,
  });
});

/**
 * GET /api/events?since={sequence} — incremental log read straight from `events.db`.
 * `since` lets a client (or a future automation/webhook dispatcher) ask for only what it
 * hasn't seen yet, per the "single log everyone can react to" design.
 */
app.get('/api/events', async (c) => {
  const since = Number(c.req.query('since') ?? 0);
  return c.json(getEventsSince((await workspaceRepo.getWorkspace()).id, since));
});

/**
 * GET /api/audit — replays `events.db` and diffs the result against the operational tables;
 * see services/AuditService.ts. This is the "make sure the database makes sense" check: a
 * read-only report, never a repair.
 */
app.get('/api/audit', async (c) => c.json(await auditService.run()));

app.route('/api', issuesRouter);
app.route('/api', catalogRouter);
app.route('/api', planningRouter);
app.route('/api', workflowRouter);
app.route('/api', automationsRouter);
app.route('/api', agentsRouter);
app.route('/api', webhooksRouter);
app.route('/api', workspaceRouter);
