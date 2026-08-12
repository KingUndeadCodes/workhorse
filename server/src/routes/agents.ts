import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Agent, AgentApprovalPolicy, AgentBudget, AutomationAction, EventType } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { agentRepo, agentRunRepo, engine, userRepo, workspaceRepo } from '../container';

/** CRUD for agent definitions, plus manual triggering and run approval — execution lives in {@link EventEngine}. */
export const agentsRouter = new Hono<{ Variables: AuthVariables }>();

agentsRouter.get('/agents', async (c) => c.json(await agentRepo.list()));
agentsRouter.get('/agent-runs', async (c) => c.json(await agentRunRepo.list()));

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
    model?: string;
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
    model: body.model?.trim() || 'claude-haiku-4-5',
    eventFilter: body.eventFilter,
    allowedActionTypes: body.allowedActionTypes,
    approvalPolicy: body.approvalPolicy,
    budget: body.budget,
    ignoreSelfTriggeredEvents: true,
    createdAt: now,
  };
  await agentRepo.create(agent);
  return c.json(agent, 201);
});

agentsRouter.patch('/agents/:userId', async (c) => {
  const userId = c.req.param('userId');
  const existing = await agentRepo.get(userId);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Partial<Agent>>();
  const merged: Agent = { ...existing, ...body, userId: existing.userId };
  await agentRepo.update(merged);
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
