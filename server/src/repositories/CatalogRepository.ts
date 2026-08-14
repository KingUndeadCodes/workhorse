import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToComponent, rowToFieldDefinition, rowToIssueType, rowToLabel, rowToVersion } from '../db/mappers';
import type { Component, FieldDefinition, IssueType, Label, ProjectVersion } from '../domain';

/**
 * Reads/writes for project/workspace reference data: labels, components, versions, custom
 * field definitions. None of this emits log events — see the same distinction drawn in
 * catalog.ts's original comment (config, not activity).
 */
export class CatalogRepository {
  constructor(private readonly db: Kysely<DB>) {}

  // ---- Labels ----

  async listLabels(): Promise<Label[]> {
    return (await this.db.selectFrom('labels').selectAll().execute()).map(rowToLabel);
  }

  async createLabel(name: string, color?: string): Promise<Label> {
    const id = `lbl_${randomUUID()}`;
    await this.db.insertInto('labels').values({ id, name, color: color ?? null }).execute();
    persistState();
    return { id, name, color };
  }

  async deleteLabel(id: string): Promise<void> {
    await this.db.deleteFrom('labels').where('id', '=', id).execute();
    await this.pullIdFromIssueArrayColumn('label_ids', id);
    persistState();
  }

  // ---- Components ----

  async listComponents(projectId: string): Promise<Component[]> {
    return (await this.db.selectFrom('components').selectAll().where('project_id', '=', projectId).execute()).map(rowToComponent);
  }

  async createComponent(projectId: string, name: string, description?: string, leadId?: string): Promise<Component> {
    const id = `comp_${randomUUID()}`;
    await this.db.insertInto('components').values({ id, project_id: projectId, name, description: description ?? null, lead_id: leadId ?? null }).execute();
    persistState();
    return { id, projectId, name, description, leadId };
  }

  async deleteComponent(id: string): Promise<void> {
    await this.db.deleteFrom('components').where('id', '=', id).execute();
    await this.pullIdFromIssueArrayColumn('component_ids', id);
    persistState();
  }

  // ---- Versions ----

  async listVersions(projectId: string): Promise<ProjectVersion[]> {
    return (await this.db.selectFrom('versions').selectAll().where('project_id', '=', projectId).execute()).map(rowToVersion);
  }

  async createVersion(projectId: string, name: string, description?: string, releaseDate?: string): Promise<ProjectVersion> {
    const id = `ver_${randomUUID()}`;
    await this.db.insertInto('versions').values({ id, project_id: projectId, name, description: description ?? null, release_date: releaseDate ?? null, released_at: null, archived_at: null }).execute();
    persistState();
    return { id, projectId, name, description, releaseDate };
  }

  async releaseVersion(id: string): Promise<ProjectVersion | undefined> {
    await this.db.updateTable('versions').set({ released_at: new Date().toISOString() }).where('id', '=', id).execute();
    persistState();
    const row = await this.db.selectFrom('versions').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToVersion(row) : undefined;
  }

  async deleteVersion(id: string): Promise<void> {
    await this.db.deleteFrom('versions').where('id', '=', id).execute();
    await this.pullIdFromIssueArrayColumn('fix_version_ids', id);
    persistState();
  }

  // ---- Issue types ----

  /** Deliberately unfiltered — issue types are a shared catalog across every project (see seed.ts's `project_id = NULL`), not project-scoped like components/versions. */
  async listIssueTypes(): Promise<IssueType[]> {
    return (await this.db.selectFrom('issue_types').selectAll().execute()).map(rowToIssueType);
  }

  // ---- Custom fields ----

  async listFieldDefinitions(): Promise<FieldDefinition[]> {
    return (await this.db.selectFrom('field_definitions').selectAll().execute()).map(rowToFieldDefinition);
  }

  async createField(field: FieldDefinition): Promise<FieldDefinition> {
    await this.db
      .insertInto('field_definitions')
      .values({
        id: field.id,
        workspace_id: field.workspaceId,
        key: field.key,
        name: field.name,
        type: field.type,
        options: JSON.stringify(field.options ?? null),
        formula: field.formula ?? null,
        scope: JSON.stringify(field.scope),
        is_required: field.isRequired ? 1 : 0,
      })
      .execute();
    persistState();
    return field;
  }

  async updateField(id: string, changes: Partial<FieldDefinition>): Promise<FieldDefinition | undefined> {
    const existing = (await this.listFieldDefinitions()).find((f) => f.id === id);
    if (!existing) return undefined;
    const merged: FieldDefinition = { ...existing, ...changes };
    await this.db
      .updateTable('field_definitions')
      .set({
        key: merged.key,
        name: merged.name,
        type: merged.type,
        options: JSON.stringify(merged.options ?? null),
        formula: merged.formula ?? null,
        scope: JSON.stringify(merged.scope),
        is_required: merged.isRequired ? 1 : 0,
      })
      .where('id', '=', id)
      .execute();
    persistState();
    return merged;
  }

  async deleteField(id: string): Promise<void> {
    await this.db.deleteFrom('field_definitions').where('id', '=', id).execute();
    persistState();
  }

  /** Removes `id` from a JSON-array column on every issue that references it — done in JS
   * rather than a SQL string REPLACE, since surgically editing a JSON array as text can
   * leave behind invalid JSON (a stray comma, an empty element) depending on position. */
  private async pullIdFromIssueArrayColumn(column: 'label_ids' | 'component_ids' | 'fix_version_ids', id: string): Promise<void> {
    const rows = await this.db.selectFrom('issues').select(['id', column]).where(column, 'like', `%${id}%`).execute();
    for (const row of rows) {
      const raw = row[column] as string | null;
      const ids: string[] = raw ? JSON.parse(raw) : [];
      if (!ids.includes(id)) continue;
      await this.db.updateTable('issues').set({ [column]: JSON.stringify(ids.filter((x) => x !== id)) }).where('id', '=', row.id).execute();
    }
  }
}
