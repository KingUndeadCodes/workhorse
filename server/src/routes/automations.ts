import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AutomationRule } from '../domain';
import { requireNonGuest, type AuthVariables } from '../auth/middleware';
import { automationRepo } from '../container';

/** CRUD for automation rule definitions. Execution itself lives in {@link EventEngine}, run against every emitted event. */
export const automationsRouter = new Hono<{ Variables: AuthVariables }>();

const EDITABLE_RULE_FIELDS = ['projectId', 'name', 'enabled', 'conditions', 'actions', 'eventFilter'] as const;

/** The subset of `body` a client is allowed to set on a rule — never `id`. */
function pickRuleFields(body: Partial<AutomationRule>): Partial<AutomationRule> {
  const picked: Record<string, unknown> = {};
  for (const key of EDITABLE_RULE_FIELDS) if (key in body) picked[key] = body[key];
  return picked as Partial<AutomationRule>;
}

automationsRouter.get('/automations', async (c) => c.json(await automationRepo.list()));

automationsRouter.post('/automations', async (c) => {
  const forbidden = await requireNonGuest(c, 'manage automation rules');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const body = await c.req.json<Partial<AutomationRule>>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  // Copy only the fields a client may set, with the id generated last — spreading the body would let a
  // client-supplied `id` (or any stray field) override what the server decides.
  const rule: AutomationRule = { ...pickRuleFields(body), id: `rule_${randomUUID()}` } as AutomationRule;
  return c.json(await automationRepo.create(rule), 201);
});

automationsRouter.patch('/automations/:id', async (c) => {
  const forbidden = await requireNonGuest(c, 'manage automation rules');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const body = await c.req.json<Partial<AutomationRule>>();
  const updated = await automationRepo.update(c.req.param('id'), pickRuleFields(body));
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

automationsRouter.delete('/automations/:id', async (c) => {
  const forbidden = await requireNonGuest(c, 'manage automation rules');
  if (forbidden) return c.json({ error: forbidden }, 403);
  await automationRepo.delete(c.req.param('id'));
  return c.json({ ok: true });
});
