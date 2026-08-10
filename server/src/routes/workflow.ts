import { Hono } from 'hono';
import type { StatusCategory } from '../domain';
import { workflowRepo } from '../container';

/** CRUD for workflow configuration — status categories, statuses, and transitions. Direct
 * writes via {@link workflowRepo}, same reasoning as catalog.ts: definitions, not activity. */
export const workflowRouter = new Hono();

workflowRouter.get('/status-categories', async (c) => c.json(await workflowRepo.listStatusCategories()));

/** POST /api/status-categories — adds a category beyond the seeded to-do/in-progress/done defaults. */
workflowRouter.post('/status-categories', async (c) => {
  const body = await c.req.json<Pick<StatusCategory, 'name' | 'type' | 'color'>>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  return c.json(await workflowRepo.createStatusCategory(body.name.trim(), body.type, body.color), 201);
});

workflowRouter.patch('/status-categories/:id', async (c) => {
  const body = await c.req.json<Partial<StatusCategory>>();
  const updated = await workflowRepo.updateStatusCategory(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

workflowRouter.get('/workflow', async (c) => c.json(await workflowRepo.getWorkflow()));

/** POST /api/workflow/statuses — adds a named status under an existing category. */
workflowRouter.post('/workflow/statuses', async (c) => {
  const body = await c.req.json<{ name: string; categoryId: string; color?: string }>();
  if (!body.name?.trim() || !body.categoryId) return c.json({ error: 'name and categoryId are required' }, 400);
  return c.json(await workflowRepo.createStatus(body.name.trim(), body.categoryId, body.color), 201);
});

/** POST /api/workflow/transitions — adds a legal move between two statuses. */
workflowRouter.post('/workflow/transitions', async (c) => {
  const body = await c.req.json<{ name: string; fromStatusId?: string; toStatusId: string }>();
  if (!body.name?.trim() || !body.toStatusId) return c.json({ error: 'name and toStatusId are required' }, 400);
  return c.json(await workflowRepo.createTransition(body.name.trim(), body.toStatusId, body.fromStatusId), 201);
});

workflowRouter.delete('/workflow/transitions/:id', async (c) => {
  await workflowRepo.deleteTransition(c.req.param('id'));
  return c.json({ ok: true });
});
