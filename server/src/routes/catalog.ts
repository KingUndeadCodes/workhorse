import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { FieldDefinition } from '../domain';
import { catalogRepo, projectRepo, workspaceRepo } from '../container';

/**
 * CRUD for project/workspace reference data: labels, custom field
 * definitions. None of this emits log events — these are configuration/schema changes, not
 * the kind of runtime activity a notification or webhook subscriber cares about (see the
 * same distinction drawn for automation-rule and workflow definitions) — so it goes through
 * {@link catalogRepo} directly rather than {@link EventEngine}.
 */
export const catalogRouter = new Hono();

// ---- Labels ---------------------------------------------------------------

catalogRouter.get('/labels', async (c) => c.json(await catalogRepo.listLabels()));

catalogRouter.post('/labels', async (c) => {
  const body = await c.req.json<{ name: string; color?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  return c.json(await catalogRepo.createLabel(body.name.trim(), body.color), 201);
});

catalogRouter.delete('/labels/:id', async (c) => {
  await catalogRepo.deleteLabel(c.req.param('id'));
  return c.json({ ok: true });
});

// ---- Custom fields ------------------------------------------------------------

catalogRouter.get('/fields', async (c) => c.json(await catalogRepo.listFieldDefinitions()));

catalogRouter.post('/fields', async (c) => {
  const body = await c.req.json<Omit<FieldDefinition, 'id' | 'workspaceId'>>();
  if (!body.key?.trim() || !body.name?.trim()) return c.json({ error: 'key and name are required' }, 400);
  const workspace = await workspaceRepo.getWorkspace();
  // id and workspaceId come last so a client-supplied value can't override what the server decides.
  const field: FieldDefinition = { ...body, id: `field_${randomUUID()}`, workspaceId: workspace.id };
  return c.json(await catalogRepo.createField(field), 201);
});

catalogRouter.patch('/fields/:id', async (c) => {
  const { id: _id, workspaceId: _workspaceId, ...changes } = await c.req.json<Partial<FieldDefinition>>();
  const updated = await catalogRepo.updateField(c.req.param('id'), changes);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

catalogRouter.delete('/fields/:id', async (c) => {
  await catalogRepo.deleteField(c.req.param('id'));
  return c.json({ ok: true });
});
