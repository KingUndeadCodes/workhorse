import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Agent, AgentApprovalPolicy, AgentBudget, AutomationAction, EventType } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { agentRepo, agentRunRepo, agentRuntimes, engine, userRepo, workspaceRepo } from '../container';

/** CRUD for agent definitions, plus manual triggering and run approval — execution lives in {@link EventEngine}. */
export const agentsRouter = new Hono<{ Variables: AuthVariables }>();

agentsRouter.get('/agents', async (c) => c.json(await agentRepo.list()));
agentsRouter.get('/agent-runs', async (c) => c.json(await agentRunRepo.list()));
/** GET /api/agent-runtimes — ids of every {@link AgentRuntime} actually registered in container.ts, so the client can offer a choice (or skip asking entirely) instead of hardcoding a provider name it has no way to know is real. */
agentsRouter.get('/agent-runtimes', (c) => c.json(agentRuntimes.list().map((r) => r.id)));

/**
 * POST /api/agents — registers a new agent. Since an Agent is a User (`kind: 'agent'`)
 * plus a behavior record, this creates both: a synthetic user row so the agent is
 * assignable/mentionable/watchable immediately, and the Agent record itself. Both are
 * direct writes — registering an agent is configuration, not something that happened.
 */
agentsRouter.post('/agents', async (c) => {
  const body = await c.req.json<{
    name: string;
    description?: string;
    runtime?: string;
    model?: string;
    contextScope?: Agent['contextScope'];
    eventFilter: EventType[] | '*';
    allowedActionTypes: AutomationAction['type'][];
    approvalPolicy: AgentApprovalPolicy;
    budget: AgentBudget;
  }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

  const userId = `u_agent_${randomUUID()}`;
  const slug = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const now = new Date().toISOString();
  await userRepo.createAgentUser(userId, `${slug}@meridian.dev`, body.name.trim(), now);

  const agent: Agent = {
    userId,
    workspaceId: (await workspaceRepo.getWorkspace()).id,
    projectId: null,
    name: body.name.trim(),
    description: body.description,
    enabled: true,
    runtime: body.runtime?.trim() || 'ollama',
    model: body.model?.trim() || 'llama3.1',
    contextScope: body.contextScope || 'ticket',
    eventFilter: body.eventFilter,
    allowedActionTypes: body.allowedActionTypes,
    approvalPolicy: body.approvalPolicy,
    budget: body.budget,
    ignoreSelfTriggeredEvents: true,
    createdAt: now,
  };
  await agentRepo.create(agent);
  // The frontend's `agents` store is separate from `users` (assignee pickers/@mentions read
  // `users`) — return the User row too so callers can add it to both, or a newly created agent
  // is invisible everywhere except Settings until the next full reload.
  const user = await userRepo.getById(userId);
  return c.json({ agent, user }, 201);
});

/**
 * An Agent's `name` and its underlying `User.displayName` are two separate columns (see
 * POST /agents above, which writes both at creation) — without this, renaming an agent here
 * would silently desync them, so every chip/avatar/mention elsewhere (all read from `User`)
 * would keep showing the old name while this agent's own settings/overview show the new one.
 */
const AGENT_PATCHABLE_FIELDS = [
  'name', 'description', 'enabled', 'runtime', 'model', 'contextScope',
  'eventFilter', 'allowedActionTypes', 'approvalPolicy', 'budget', 'ignoreSelfTriggeredEvents',
] as const;

agentsRouter.patch('/agents/:userId', async (c) => {
  const userId = c.req.param('userId');
  const existing = await agentRepo.get(userId);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  // `userId`/`workspaceId`/`projectId`/`createdAt` are identity/provenance, not editable
  // config — only the fields below may come from the client, unlike a naive `{...existing,
  // ...body}` spread of an unchecked `Partial<Agent>`, which would let a client silently
  // rescope an agent to a different project or corrupt its workspace/creation bookkeeping.
  const body = await c.req.json<Partial<Pick<Agent, (typeof AGENT_PATCHABLE_FIELDS)[number]>>>();
  const name = body.name?.trim();
  const changes: Partial<Agent> = {};
  for (const field of AGENT_PATCHABLE_FIELDS) {
    if (field in body) (changes as Record<string, unknown>)[field] = field === 'name' ? name : body[field];
  }
  const merged: Agent = { ...existing, ...changes, userId: existing.userId };
  await agentRepo.update(merged);
  if (name && name !== existing.name) {
    await userRepo.updateProfile(userId, { displayName: name });
  }
  return c.json(merged);
});

/**
 * POST /api/agents/:userId/trigger — manual trigger. Body: `{ issueId? }`; the triggering
 * user is the authenticated caller. Appends an `agent.manuallyTriggered` event regardless;
 * only produces an {@link AgentRun} if `issueId` is given (the stubbed decision logic needs
 * an issue to reason about).
 */
agentsRouter.post('/agents/:userId/trigger', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json<{ issueId?: string }>();
  try {
    const result = await engine.triggerAgentManually(userId, c.get('user').id, body.issueId);
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to trigger agent';
    return c.json({ error: message }, message === 'Agent not found' ? 404 : 400);
  }
});

/** POST /api/agent-runs/:id/approve — executes a run that was `awaitingApproval`. */
agentsRouter.post('/agent-runs/:id/approve', async (c) => {
  const id = c.req.param('id');
  const run = await engine.resolveAgentRun(id, 'approved', c.get('user').id);
  if (!run) return c.json({ error: 'Run not found or not awaiting approval' }, 404);
  return c.json({ run });
});

/** POST /api/agent-runs/:id/reject — discards a run that was `awaitingApproval`. */
agentsRouter.post('/agent-runs/:id/reject', async (c) => {
  const id = c.req.param('id');
  const run = await engine.resolveAgentRun(id, 'rejected', c.get('user').id);
  if (!run) return c.json({ error: 'Run not found or not awaiting approval' }, 404);
  return c.json({ run });
});
