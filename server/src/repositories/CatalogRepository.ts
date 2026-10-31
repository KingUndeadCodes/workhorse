import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToFieldDefinition, rowToIssueType, rowToLabel } from '../db/mappers';
import type { FieldDefinition, IssueType, Label } from '../domain';

/**
 * Reads/writes for project/workspace reference data: labels, custom
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

  // ---- Issue types ----

  /** Deliberately unfiltered — issue types are a shared catalog across every project (see seed.ts's `project_id = NULL`). */
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
  private async pullIdFromIssueArrayColumn(column: 'label_ids', id: string): Promise<void> {
    const rows = await this.db.selectFrom('issues').select(['id', column]).where(column, 'like', `%${id}%`).execute();
    for (const row of rows) {
      const raw = row[column] as string | null;
      const ids: string[] = raw ? JSON.parse(raw) : [];
      if (!ids.includes(id)) continue;
      await this.db.updateTable('issues').set({ [column]: JSON.stringify(ids.filter((x) => x !== id)) }).where('id', '=', row.id).execute();
    }
  }
}
