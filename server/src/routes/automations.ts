import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AutomationRule } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { automationRepo, workspaceRepo } from '../container';

/** CRUD for automation rule definitions. Execution itself lives in {@link EventEngine}, run against every emitted event. */
export const automationsRouter = new Hono<{ Variables: AuthVariables }>();

/** A rule's `actions` execute workspace-wide against every matching future event — guests (read-mostly by convention, see WorkspaceRole) may not define them. */
async function requireNonGuest(c: { get: (k: 'user') => { id: string } }): Promise<string | undefined> {
  const caller = await workspaceRepo.getMember(c.get('user').id);
  if (!caller || caller.role === 'guest') return 'Guests cannot manage automation rules';
  return undefined;
}

automationsRouter.get('/automations', async (c) => c.json(await automationRepo.list()));

automationsRouter.post('/automations', async (c) => {
  const forbidden = await requireNonGuest(c);
  if (forbidden) return c.json({ error: forbidden }, 403);
  const body = await c.req.json<Omit<AutomationRule, 'id'>>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const rule: AutomationRule = { id: `rule_${randomUUID()}`, ...body };
  return c.json(await automationRepo.create(rule), 201);
});

automationsRouter.patch('/automations/:id', async (c) => {
  const forbidden = await requireNonGuest(c);
  if (forbidden) return c.json({ error: forbidden }, 403);
  const body = await c.req.json<Partial<AutomationRule>>();
  const updated = await automationRepo.update(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

automationsRouter.delete('/automations/:id', async (c) => {
  const forbidden = await requireNonGuest(c);
  if (forbidden) return c.json({ error: forbidden }, 403);
  await automationRepo.delete(c.req.param('id'));
  return c.json({ ok: true });
});
