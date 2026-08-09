import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Agent, AgentApprovalPolicy, AgentBudget, AutomationAction, EventType } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { persistState, run, stateDb } from '../db/core';
import { agentParams } from '../db/mappers';
import { resolveAgentRun, triggerAgentManually } from '../engine';
import { getAgent, getWorkspace, listAgentRuns, listAgents } from '../queries';

/** CRUD for agent definitions, plus manual triggering and run approval — execution lives in engine.ts. */
export const agentsRouter = new Hono<{ Variables: AuthVariables }>();

agentsRouter.get('/agents', async (c) => c.json(await listAgents()));
agentsRouter.get('/agent-runs', async (c) => c.json(await listAgentRuns()));

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
    eventFilter: EventType[] | '*';
    allowedActionTypes: AutomationAction['type'][];
    approvalPolicy: AgentApprovalPolicy;
    budget: AgentBudget;
  }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

  const userId = `u_agent_${randomUUID()}`;
  const slug = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const now = new Date().toISOString();
  run(stateDb, `INSERT INTO users (id, kind, email, display_name, avatar_url, status, created_at) VALUES (?, 'agent', ?, ?, NULL, 'active', ?)`, [userId, `${slug}@meridian.dev`, body.name.trim(), now]);

  const agent: Agent = {
    userId,
    workspaceId: (await getWorkspace()).id,
    projectId: null,
    name: body.name.trim(),
    description: body.description,
    enabled: true,
    eventFilter: body.eventFilter,
    allowedActionTypes: body.allowedActionTypes,
    approvalPolicy: body.approvalPolicy,
    budget: body.budget,
    ignoreSelfTriggeredEvents: true,
    createdAt: now,
  };
  run(stateDb, `INSERT INTO agents (user_id, workspace_id, project_id, name, description, enabled, event_filter, allowed_action_types, approval_policy, budget, ignore_self_triggered_events, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, agentParams(agent));
  persistState();
  return c.json(agent, 201);
});

agentsRouter.patch('/agents/:userId', async (c) => {
  const userId = c.req.param('userId');
  const existing = await getAgent(userId);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Partial<Agent>>();
  const merged: Agent = { ...existing, ...body, userId: existing.userId };
  run(stateDb, `UPDATE agents SET name = ?, description = ?, enabled = ?, event_filter = ?, allowed_action_types = ?, approval_policy = ?, budget = ?, ignore_self_triggered_events = ? WHERE user_id = ?`, [
    merged.name, merged.description ?? null, merged.enabled ? 1 : 0, JSON.stringify(merged.eventFilter), JSON.stringify(merged.allowedActionTypes), JSON.stringify(merged.approvalPolicy), JSON.stringify(merged.budget), merged.ignoreSelfTriggeredEvents ? 1 : 0, userId,
  ]);
  persistState();
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
    const result = await triggerAgentManually(userId, c.get('user').id, body.issueId);
    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to trigger agent' }, 404);
  }
});

/** POST /api/agent-runs/:id/approve — executes a run that was `awaitingApproval`. */
agentsRouter.post('/agent-runs/:id/approve', async (c) => {
  const id = c.req.param('id');
  const run = await resolveAgentRun(id, 'approved', c.get('user').id);
  if (!run) return c.json({ error: 'Run not found or not awaiting approval' }, 404);
  return c.json({ run });
});

/** POST /api/agent-runs/:id/reject — discards a run that was `awaitingApproval`. */
agentsRouter.post('/agent-runs/:id/reject', async (c) => {
  const id = c.req.param('id');
  const run = await resolveAgentRun(id, 'rejected', c.get('user').id);
  if (!run) return c.json({ error: 'Run not found or not awaiting approval' }, 404);
  return c.json({ run });
});
