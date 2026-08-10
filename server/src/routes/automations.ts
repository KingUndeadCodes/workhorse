import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AutomationRule } from '../domain';
import { automationRepo } from '../container';

/** CRUD for automation rule definitions. Execution itself lives in {@link EventEngine}, run against every emitted event. */
export const automationsRouter = new Hono();

automationsRouter.get('/automations', async (c) => c.json(await automationRepo.list()));

automationsRouter.post('/automations', async (c) => {
  const body = await c.req.json<Omit<AutomationRule, 'id'>>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const rule: AutomationRule = { id: `rule_${randomUUID()}`, ...body };
  return c.json(await automationRepo.create(rule), 201);
});

automationsRouter.patch('/automations/:id', async (c) => {
  const body = await c.req.json<Partial<AutomationRule>>();
  const updated = await automationRepo.update(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

automationsRouter.delete('/automations/:id', async (c) => {
  await automationRepo.delete(c.req.param('id'));
  return c.json({ ok: true });
});
