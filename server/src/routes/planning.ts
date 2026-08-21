import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware';
import { engine, planningRepo, projectRepo, workspaceRepo } from '../container';

export const planningRouter = new Hono<{ Variables: AuthVariables }>();

// ---- Sprints ----------------------------------------------------------------

planningRouter.get('/sprints', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: 'projectId is required' }, 400);
  return c.json(await planningRepo.listSprints(projectId));
});

planningRouter.post('/sprints', async (c) => {
  const body = await c.req.json<{ name: string; goal?: string; startDate?: string; endDate?: string; projectId: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  if (!body.projectId?.trim()) return c.json({ error: 'projectId is required' }, 400);
  if (!(await projectRepo.getProjectById(body.projectId))) return c.json({ error: 'Unknown projectId' }, 400);
  return c.json(await planningRepo.createSprint(body.projectId, body.name.trim(), body.goal, body.startDate, body.endDate), 201);
});

/** POST /api/sprints/:id/start — emits `sprint.started`. */
planningRouter.post('/sprints/:id/start', async (c) => {
  const id = c.req.param('id');
  if (!(await planningRepo.getSprint(id))) return c.json({ error: 'Not found' }, 404);
  const event = await engine.emitEvent({ actor: { kind: 'user', userId: c.get('user').id }, subject: { type: 'sprint', id }, payload: { type: 'sprint.started', sprintId: id } });
  return c.json({ sprint: await planningRepo.getSprint(id), event });
});

/** POST /api/sprints/:id/complete — emits `sprint.completed`. */
planningRouter.post('/sprints/:id/complete', async (c) => {
  const id = c.req.param('id');
  if (!(await planningRepo.getSprint(id))) return c.json({ error: 'Not found' }, 404);
  const event = await engine.emitEvent({ actor: { kind: 'user', userId: c.get('user').id }, subject: { type: 'sprint', id }, payload: { type: 'sprint.completed', sprintId: id } });
  return c.json({ sprint: await planningRepo.getSprint(id), event });
});

// ---- Saved views / filters ----------------------------------------------------

planningRouter.get('/views', async (c) => c.json(await planningRepo.listSavedViews()));

planningRouter.post('/views', async (c) => {
  const body = await c.req.json<{ name: string; isShared?: boolean; query: unknown }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const workspace = await workspaceRepo.getWorkspace();
  return c.json(await planningRepo.createSavedView(workspace.id, body.name.trim(), c.get('user').id, body.isShared ?? false, body.query), 201);
});

planningRouter.delete('/views/:id', async (c) => {
  const id = c.req.param('id');
  const view = await planningRepo.getSavedView(id);
  if (!view) return c.json({ error: 'Not found' }, 404);
  if (view.ownerId && view.ownerId !== c.get('user').id) return c.json({ error: 'Only the owner can delete this view' }, 403);
  await planningRepo.deleteSavedView(id);
  return c.json({ ok: true });
});
