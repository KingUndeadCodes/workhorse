import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { StatusCategory } from '../domain';
import { persistState, run, stateDb } from '../db/core';
import { getWorkflow, listStatusCategories } from '../queries';

/** CRUD for workflow configuration — status categories, statuses, and transitions. Direct
 * writes to `state.db`, same reasoning as catalog.ts: definitions, not activity. */
export const workflowRouter = new Hono();

workflowRouter.get('/status-categories', async (c) => c.json(await listStatusCategories()));

/** POST /api/status-categories — adds a category beyond the seeded to-do/in-progress/done defaults. */
workflowRouter.post('/status-categories', async (c) => {
  const body = await c.req.json<Pick<StatusCategory, 'name' | 'type' | 'color'>>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const id = `cat_${randomUUID()}`;
  const order = (await listStatusCategories()).length;
  run(stateDb, `INSERT INTO status_categories (id, workspace_id, name, type, color, sort_order) VALUES (?, (SELECT id FROM workspace LIMIT 1), ?, ?, ?, ?)`, [id, body.name.trim(), body.type, body.color ?? null, order]);
  persistState();
  return c.json((await listStatusCategories()).find((cat) => cat.id === id), 201);
});

workflowRouter.patch('/status-categories/:id', async (c) => {
  const id = c.req.param('id');
  const existing = (await listStatusCategories()).find((cat) => cat.id === id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Partial<StatusCategory>>();
  const merged = { ...existing, ...body };
  run(stateDb, `UPDATE status_categories SET name = ?, type = ?, color = ? WHERE id = ?`, [merged.name, merged.type, merged.color ?? null, id]);
  persistState();
  return c.json(merged);
});

workflowRouter.get('/workflow', async (c) => c.json(await getWorkflow()));

/** POST /api/workflow/statuses — adds a named status under an existing category. */
workflowRouter.post('/workflow/statuses', async (c) => {
  const body = await c.req.json<{ name: string; categoryId: string; color?: string }>();
  if (!body.name?.trim() || !body.categoryId) return c.json({ error: 'name and categoryId are required' }, 400);
  const id = `st_${randomUUID()}`;
  const workflow = await getWorkflow();
  run(stateDb, `INSERT INTO workflow_statuses (id, workflow_id, name, category_id, color) VALUES (?, ?, ?, ?, ?)`, [id, workflow.id, body.name.trim(), body.categoryId, body.color ?? null]);
  persistState();
  return c.json((await getWorkflow()).statuses.find((s) => s.id === id), 201);
});

/** POST /api/workflow/transitions — adds a legal move between two statuses. */
workflowRouter.post('/workflow/transitions', async (c) => {
  const body = await c.req.json<{ name: string; fromStatusId?: string; toStatusId: string }>();
  if (!body.name?.trim() || !body.toStatusId) return c.json({ error: 'name and toStatusId are required' }, 400);
  const id = `tr_${randomUUID()}`;
  const workflow = await getWorkflow();
  run(stateDb, `INSERT INTO workflow_transitions (id, workflow_id, name, from_status_id, to_status_id, required_field_ids) VALUES (?, ?, ?, ?, ?, NULL)`, [
    id, workflow.id, body.name.trim(), body.fromStatusId ?? '*', body.toStatusId,
  ]);
  persistState();
  return c.json((await getWorkflow()).transitions.find((t) => t.id === id), 201);
});

workflowRouter.delete('/workflow/transitions/:id', (c) => {
  run(stateDb, `DELETE FROM workflow_transitions WHERE id = ?`, [c.req.param('id')]);
  persistState();
  return c.json({ ok: true });
});
