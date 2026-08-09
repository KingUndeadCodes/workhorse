import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { FieldDefinition } from '../domain';
import { all, persistState, run, stateDb } from '../db/core';
import { fieldDefinitionParams } from '../db/mappers';
import { getProject, listComponents, listFieldDefinitions, listLabels, listVersions } from '../queries';

/** Removes `id` from a JSON-array column on every issue that references it — done in JS
 * rather than a SQL string REPLACE, since surgically editing a JSON array as text can
 * leave behind invalid JSON (a stray comma, an empty element) depending on position. */
function pullIdFromIssueArrayColumn(column: 'label_ids' | 'component_ids' | 'fix_version_ids', id: string): void {
  const rows = all<{ id: string; value: string | null }>(stateDb, `SELECT id, ${column} as value FROM issues WHERE ${column} LIKE ?`, [`%${id}%`]);
  for (const row of rows) {
    const ids: string[] = row.value ? JSON.parse(row.value) : [];
    if (!ids.includes(id)) continue;
    run(stateDb, `UPDATE issues SET ${column} = ? WHERE id = ?`, [JSON.stringify(ids.filter((x) => x !== id)), row.id]);
  }
}

/**
 * CRUD for project/workspace reference data: labels, components, versions, custom field
 * definitions. None of this emits log events — these are configuration/schema changes,
 * not the kind of runtime activity a notification or webhook subscriber cares about (see
 * the same distinction drawn for automation-rule and workflow definitions) — and, per the
 * event-log/projector split, they write `state.db` directly rather than through the log.
 * Every handler below calls {@link persistState} itself since it isn't going through the
 * projector, which is where that call usually lives.
 */
export const catalogRouter = new Hono();

// ---- Labels ---------------------------------------------------------------

catalogRouter.get('/labels', async (c) => c.json(await listLabels()));

catalogRouter.post('/labels', async (c) => {
  const body = await c.req.json<{ name: string; color?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const id = `lbl_${randomUUID()}`;
  run(stateDb, `INSERT INTO labels (id, name, color) VALUES (?, ?, ?)`, [id, body.name.trim(), body.color ?? null]);
  persistState();
  return c.json({ id, name: body.name.trim(), color: body.color }, 201);
});

catalogRouter.delete('/labels/:id', (c) => {
  const id = c.req.param('id');
  run(stateDb, `DELETE FROM labels WHERE id = ?`, [id]);
  pullIdFromIssueArrayColumn('label_ids', id);
  persistState();
  return c.json({ ok: true });
});

// ---- Components -------------------------------------------------------------

catalogRouter.get('/components', async (c) => c.json(await listComponents()));

catalogRouter.post('/components', async (c) => {
  const body = await c.req.json<{ name: string; description?: string; leadId?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const id = `comp_${randomUUID()}`;
  const project = await getProject();
  run(stateDb, `INSERT INTO components (id, project_id, name, description, lead_id) VALUES (?, ?, ?, ?, ?)`, [id, project.id, body.name.trim(), body.description ?? null, body.leadId ?? null]);
  persistState();
  return c.json({ id, projectId: project.id, name: body.name.trim(), description: body.description, leadId: body.leadId }, 201);
});

catalogRouter.delete('/components/:id', (c) => {
  const id = c.req.param('id');
  run(stateDb, `DELETE FROM components WHERE id = ?`, [id]);
  pullIdFromIssueArrayColumn('component_ids', id);
  persistState();
  return c.json({ ok: true });
});

// ---- Versions / releases ----------------------------------------------------

catalogRouter.get('/versions', async (c) => c.json(await listVersions()));

catalogRouter.post('/versions', async (c) => {
  const body = await c.req.json<{ name: string; description?: string; releaseDate?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  const id = `ver_${randomUUID()}`;
  const project = await getProject();
  run(stateDb, `INSERT INTO versions (id, project_id, name, description, release_date, released_at, archived_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)`, [id, project.id, body.name.trim(), body.description ?? null, body.releaseDate ?? null]);
  persistState();
  return c.json({ id, projectId: project.id, name: body.name.trim(), description: body.description, releaseDate: body.releaseDate }, 201);
});

/** POST /api/versions/:id/release — marks a version as actually shipped. */
catalogRouter.post('/versions/:id/release', async (c) => {
  const id = c.req.param('id');
  run(stateDb, `UPDATE versions SET released_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
  persistState();
  return c.json((await listVersions()).find((v) => v.id === id));
});

catalogRouter.delete('/versions/:id', (c) => {
  const id = c.req.param('id');
  run(stateDb, `DELETE FROM versions WHERE id = ?`, [id]);
  pullIdFromIssueArrayColumn('fix_version_ids', id);
  persistState();
  return c.json({ ok: true });
});

// ---- Custom fields ------------------------------------------------------------

catalogRouter.get('/fields', async (c) => c.json(await listFieldDefinitions()));

catalogRouter.post('/fields', async (c) => {
  const body = await c.req.json<Omit<FieldDefinition, 'id' | 'workspaceId'>>();
  if (!body.key?.trim() || !body.name?.trim()) return c.json({ error: 'key and name are required' }, 400);
  const field: FieldDefinition = { id: `field_${randomUUID()}`, workspaceId: (await getProject()).workspaceId, ...body };
  run(stateDb, `INSERT INTO field_definitions (id, workspace_id, key, name, type, options, formula, scope, is_required) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, fieldDefinitionParams(field));
  persistState();
  return c.json(field, 201);
});

catalogRouter.patch('/fields/:id', async (c) => {
  const id = c.req.param('id');
  const existing = (await listFieldDefinitions()).find((f) => f.id === id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Partial<FieldDefinition>>();
  const merged: FieldDefinition = { ...existing, ...body };
  run(stateDb, `UPDATE field_definitions SET key = ?, name = ?, type = ?, options = ?, formula = ?, scope = ?, is_required = ? WHERE id = ?`, [
    merged.key, merged.name, merged.type, JSON.stringify(merged.options ?? null), merged.formula ?? null, JSON.stringify(merged.scope), merged.isRequired ? 1 : 0, id,
  ]);
  persistState();
  return c.json(merged);
});

catalogRouter.delete('/fields/:id', (c) => {
  const id = c.req.param('id');
  run(stateDb, `DELETE FROM field_definitions WHERE id = ?`, [id]);
  persistState();
  return c.json({ ok: true });
});
