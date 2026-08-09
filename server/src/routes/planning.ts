import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware';
import { persistState, run, stateDb } from '../db/core';
import { emitEvent } from '../engine';
import { getProject, getSavedView, getSprint, getWorkspace, listSavedViews, listSprints } from '../queries';

export const planningRouter = new Hono<{ Variables: AuthVariables }>();

// ---- Sprints ----------------------------------------------------------------

planningRouter.get('/sprints', async (c) => c.json(await listSprints()));

planningRouter.post('/sprints', async (c) => {
  const body = await c.req.json<{ name: string; goal?: string; startDate?: string; endDate?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const id = `sprint_${randomUUID()}`;
  run(stateDb, `INSERT INTO sprints (id, project_id, name, goal, state, start_date, end_date, completed_at) VALUES (?, ?, ?, ?, 'future', ?, ?, NULL)`, [
    id, (await getProject()).id, body.name.trim(), body.goal ?? null, body.startDate ?? null, body.endDate ?? null,
  ]);
  persistState();
  return c.json(await getSprint(id), 201);
});

/** POST /api/sprints/:id/start — emits `sprint.started`. */
planningRouter.post('/sprints/:id/start', async (c) => {
  const id = c.req.param('id');
  if (!(await getSprint(id))) return c.json({ error: 'Not found' }, 404);
  const event = await emitEvent({ actor: { kind: 'user', userId: c.get('user').id }, subject: { type: 'sprint', id }, payload: { type: 'sprint.started', sprintId: id } });
  return c.json({ sprint: await getSprint(id), event });
});

/** POST /api/sprints/:id/complete — emits `sprint.completed`. */
planningRouter.post('/sprints/:id/complete', async (c) => {
  const id = c.req.param('id');
  if (!(await getSprint(id))) return c.json({ error: 'Not found' }, 404);
  const event = await emitEvent({ actor: { kind: 'user', userId: c.get('user').id }, subject: { type: 'sprint', id }, payload: { type: 'sprint.completed', sprintId: id } });
  return c.json({ sprint: await getSprint(id), event });
});

// ---- Saved views / filters ----------------------------------------------------

planningRouter.get('/views', async (c) => c.json(await listSavedViews()));

planningRouter.post('/views', async (c) => {
  const body = await c.req.json<{ name: string; isShared?: boolean; query: unknown }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const id = `view_${randomUUID()}`;
  run(stateDb, `INSERT INTO saved_views (id, workspace_id, name, owner_id, is_shared, query) VALUES (?, ?, ?, ?, ?, ?)`, [
    id, (await getWorkspace()).id, body.name.trim(), c.get('user').id, body.isShared ? 1 : 0, JSON.stringify(body.query ?? { all: [] }),
  ]);
  persistState();
  return c.json(await getSavedView(id), 201);
});

planningRouter.delete('/views/:id', (c) => {
  run(stateDb, `DELETE FROM saved_views WHERE id = ?`, [c.req.param('id')]);
  persistState();
  return c.json({ ok: true });
});
