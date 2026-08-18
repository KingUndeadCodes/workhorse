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
  projectRepo,
  userRepo,
  webhookRepo,
  workflowRepo,
  workspaceRepo,
} from './container';
import { getEventById, getEventsSince } from './eventLog';
import { agentsRouter } from './routes/agents';
import { automationsRouter } from './routes/automations';
import { catalogRouter } from './routes/catalog';
import { meRouter, publicAuthRouter } from './routes/auth';
import { issuesRouter } from './routes/issues';
import { planningRouter } from './routes/planning';
import { projectsRouter } from './routes/projects';
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
 * GET /api/bootstrap?projectId= — the read model for one project, plus every workspace-global
 * list (users, workflow, labels, agents, automations, webhooks — none of which vary per
 * project; see the multi-project plan's decisions #1/#2 for why workflow and issue types stay
 * shared). `projectId` defaults to the first project if omitted, which covers first-ever load
 * with nothing persisted client-side yet, and keeps pre-existing single-project deployments
 * working unchanged. 404 if the resolved project doesn't exist.
 */
app.get('/api/bootstrap', async (c) => {
  const projects = await projectRepo.listProjects();
  const requestedId = c.req.query('projectId');
  const activeProject = requestedId ? projects.find((p) => p.id === requestedId) : projects[0];
  if (!activeProject) return c.json({ error: 'No project found' }, 404);

  const [
    workspace, users, workspaceMembers, agents, agentRuns, statusCategories, workflow,
    labels, fieldDefinitions, automationRules, webhookSubscriptions,
    components, versions, issueTypes, sprints, board, savedViews,
    issues, issueLinks, comments, worklogs, attachments,
  ] = await Promise.all([
    workspaceRepo.getWorkspace(), userRepo.list(), workspaceRepo.listMembers(), agentRepo.list(), agentRunRepo.list(),
    workflowRepo.listStatusCategories(), workflowRepo.getWorkflow(),
    catalogRepo.listLabels(), catalogRepo.listFieldDefinitions(), automationRepo.list(), webhookRepo.list(),
    catalogRepo.listComponents(activeProject.id), catalogRepo.listVersions(activeProject.id), catalogRepo.listIssueTypes(),
    planningRepo.listSprints(activeProject.id), planningRepo.getBoard(activeProject.id), planningRepo.listSavedViews(),
    issueRepo.list(activeProject.id), issueRepo.listLinks(activeProject.id), issueRepo.listComments(activeProject.id),
    issueRepo.listWorklogs(activeProject.id), issueRepo.listAttachments(activeProject.id),
  ]);
  return c.json({
    workspace, users, workspaceMembers, agents, agentRuns, statusCategories, workflow,
    labels, fieldDefinitions, automationRules, webhookSubscriptions,
    projects, currentProjectId: activeProject.id,
    components, versions, issueTypes, sprints, board, savedViews,
    issues, issueLinks, comments, worklogs, attachments,
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

/** GET /api/events/:id -> `{ event }` — one event's full payload, 404 if it doesn't exist. Used to lazily fill in an Activity row's details only once a user expands it (see routes/issues.ts's `/issues/:id/events`). */
app.get('/api/events/:id', async (c) => {
  const event = getEventById(c.req.param('id'));
  if (!event) return c.json({ error: 'Event not found' }, 404);
  return c.json({ event });
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
app.route('/api', projectsRouter);
