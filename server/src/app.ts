import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { flushPersistence } from './db/core';
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
  statsService,
  userRepo,
  webhookRepo,
  workflowRepo,
  workspaceRepo,
} from './container';
import { getEventById, getEventsSince } from './eventLog';
import { toWebhookPublic } from './db/mappers';
import { agentsRouter } from './routes/agents';
import { automationsRouter } from './routes/automations';
import { catalogRouter } from './routes/catalog';
import { gitConnectionsCallbackRouter, gitConnectionsRouter } from './routes/gitConnections';
import { meRouter, publicAuthRouter } from './routes/auth';
import { issuesRouter } from './routes/issues';
import { notificationsRouter } from './routes/notifications';
import { planningRouter } from './routes/planning';
import { projectsRouter } from './routes/projects';
import { webhooksRouter } from './routes/webhooks';
import { workflowRouter } from './routes/workflow';
import { workspaceRouter } from './routes/workspace';

const EVENTS_PAGE_DEFAULT = 500;
const EVENTS_PAGE_MAX = 1000;

export const app = new Hono();

// Saves the database once per request, after the handler has finished but before the response is sent. Writes
// during a request only mark the database dirty (see db/coalescingWriter.ts) instead of rewriting the whole file
// each time. `finally` so a handler that throws still persists whatever it did before failing.
app.use('*', async (_c, next) => {
  try {
    await next();
  } finally {
    flushPersistence();
  }
});

app.use('*', cors());
// Reject oversized bodies before they're parsed: c.req.json() is otherwise unbounded, and the avatar size
// check in routes/auth.ts only runs after the whole body is already in memory. 5 MB leaves headroom over the
// 4 MB avatar cap.
app.use('/api/*', bodyLimit({ maxSize: 5 * 1024 * 1024, onError: (c) => c.json({ error: 'request body too large' }, 413) }));

// Bearer tokens aren't sent ambiently by the browser the way cookies are, so an unconfigured
// cors() above grants no extra authority to a malicious origin here — no origin allowlist needed.
app.route('/api', publicAuthRouter); // signup, login — public, no token required
app.route('/api', gitConnectionsCallbackRouter); // GitHub redirects the browser here — authorized by its signed `state`, not a bearer token

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
    labels, fieldDefinitions, automationRules, webhookSubscriptions: webhookSubscriptions.map(toWebhookPublic),
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
  // Bounded: an unbounded read returned the whole log in one response. A client that gets exactly `limit`
  // events asks again from the last sequence it received.
  const requested = Number(c.req.query('limit') ?? EVENTS_PAGE_DEFAULT);
  const limit = Math.min(Math.max(Number.isFinite(requested) ? Math.floor(requested) : EVENTS_PAGE_DEFAULT, 1), EVENTS_PAGE_MAX);
  return c.json(getEventsSince((await workspaceRepo.getWorkspace()).id, Number.isFinite(since) ? since : 0, limit));
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

/**
 * GET /api/stats — workspace-wide activity/time-spent report for all three windows (24h/1w/30d)
 * in one response; see services/StatsService.ts. Computed fresh on every call, not cached.
 */
app.get('/api/stats', async (c) => c.json(await statsService.run()));

app.route('/api', issuesRouter);
app.route('/api', catalogRouter);
app.route('/api', planningRouter);
app.route('/api', workflowRouter);
app.route('/api', automationsRouter);
app.route('/api', agentsRouter);
app.route('/api', webhooksRouter);
app.route('/api', notificationsRouter);
app.route('/api', workspaceRouter);
app.route('/api', projectsRouter);
app.route('/api', gitConnectionsRouter);
