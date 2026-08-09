import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AutomationRule } from '../domain';
import { persistState, run, stateDb } from '../db/core';
import { automationRuleParams } from '../db/mappers';
import { listAutomationRules } from '../queries';

/** CRUD for automation rule definitions. Execution itself lives in engine.ts, run against every emitted event. */
export const automationsRouter = new Hono();

automationsRouter.get('/automations', async (c) => c.json(await listAutomationRules()));

automationsRouter.post('/automations', async (c) => {
  const body = await c.req.json<Omit<AutomationRule, 'id'>>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const rule: AutomationRule = { id: `rule_${randomUUID()}`, ...body };
  run(stateDb, `INSERT INTO automation_rules (id, project_id, name, enabled, event_filter, conditions, actions) VALUES (?, ?, ?, ?, ?, ?, ?)`, automationRuleParams(rule));
  persistState();
  return c.json(rule, 201);
});

automationsRouter.patch('/automations/:id', async (c) => {
  const id = c.req.param('id');
  const existing = (await listAutomationRules()).find((r) => r.id === id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Partial<AutomationRule>>();
  const merged: AutomationRule = { ...existing, ...body };
  run(stateDb, `UPDATE automation_rules SET name = ?, enabled = ?, event_filter = ?, conditions = ?, actions = ? WHERE id = ?`, [
    merged.name, merged.enabled ? 1 : 0, JSON.stringify(merged.eventFilter), JSON.stringify(merged.conditions), JSON.stringify(merged.actions), id,
  ]);
  persistState();
  return c.json(merged);
});

automationsRouter.delete('/automations/:id', (c) => {
  run(stateDb, `DELETE FROM automation_rules WHERE id = ?`, [c.req.param('id')]);
  persistState();
  return c.json({ ok: true });
});
