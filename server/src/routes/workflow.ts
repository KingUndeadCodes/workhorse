import { Hono } from 'hono';
import type { StatusCategory } from '../domain';
import { planningRepo, workflowRepo } from '../container';

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

/** DELETE /api/status-categories/:id — only `inProgress` categories with no statuses left in them may be deleted. */
workflowRouter.delete('/status-categories/:id', async (c) => {
  const result = await workflowRepo.deleteStatusCategory(c.req.param('id'));
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json({ ok: true });
});

workflowRouter.get('/workflow', async (c) => c.json(await workflowRepo.getWorkflow()));

/**
 * POST /api/workflow/statuses — adds a named status under an existing category. Also drops
 * the new status into whichever board column already shows that category, so it doesn't
 * silently have nowhere to render (see PlanningRepository.addStatusToMatchingColumn).
 */
workflowRouter.post('/workflow/statuses', async (c) => {
  const body = await c.req.json<{ name: string; categoryId: string; color?: string }>();
  if (!body.name?.trim() || !body.categoryId) return c.json({ error: 'name and categoryId are required' }, 400);
  const status = await workflowRepo.createStatus(body.name.trim(), body.categoryId, body.color);
  const workflow = await workflowRepo.getWorkflow();
  const statusCategoryById = new Map(workflow.statuses.map((s) => [s.id, s.categoryId]));
  await planningRepo.addStatusToMatchingColumn(status.id, body.categoryId, statusCategoryById);
  return c.json(status, 201);
});

/** PATCH /api/workflow/statuses/:id — renames/recolors a status. */
workflowRouter.patch('/workflow/statuses/:id', async (c) => {
  const body = await c.req.json<Partial<Pick<{ name: string; color?: string }, 'name' | 'color'>>>();
  const updated = await workflowRepo.updateStatus(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

/** DELETE /api/workflow/statuses/:id — only statuses in an `inProgress` category, not currently used by any issue, may be deleted. */
workflowRouter.delete('/workflow/statuses/:id', async (c) => {
  const id = c.req.param('id');
  const result = await workflowRepo.deleteStatus(id);
  if (result.error) return c.json({ error: result.error }, 400);
  await planningRepo.removeStatusFromColumns(id);
  return c.json({ ok: true });
});

/** POST /api/workflow/transitions — adds a legal move between two statuses. */
workflowRouter.post('/workflow/transitions', async (c) => {
  const body = await c.req.json<{ name: string; fromStatusId?: string; toStatusId: string }>();
  if (!body.name?.trim() || !body.toStatusId) return c.json({ error: 'name and toStatusId are required' }, 400);
  return c.json(await workflowRepo.createTransition(body.name.trim(), body.toStatusId, body.fromStatusId), 201);
});

/** DELETE /api/workflow/transitions/:id — refused if it's the only remaining path from some To Do status to Done. */
workflowRouter.delete('/workflow/transitions/:id', async (c) => {
  const result = await workflowRepo.deleteTransition(c.req.param('id'));
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json({ ok: true });
});
