import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { assembleWorkflow, rowToStatusCategory, rowToWorkflowStatus, rowToWorkflowTransition } from '../db/mappers';
import type { StatusCategory, Workflow, WorkflowStatus, WorkflowTransition } from '../domain';

/** Reads/writes for workflow configuration: status categories, statuses, and transitions. */
export class WorkflowRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async listStatusCategories(): Promise<StatusCategory[]> {
    return (await this.db.selectFrom('status_categories').selectAll().orderBy('sort_order', 'asc').execute()).map(rowToStatusCategory);
  }

  async createStatusCategory(name: string, type: StatusCategory['type'], color?: string): Promise<StatusCategory> {
    const id = `cat_${randomUUID()}`;
    const order = (await this.listStatusCategories()).length;
    const workspace = await this.db.selectFrom('workspace').select('id').executeTakeFirst();
    await this.db.insertInto('status_categories').values({ id, workspace_id: workspace?.id ?? null, name, type, color: color ?? null, sort_order: order }).execute();
    persistState();
    return { id, workspaceId: workspace?.id as string, name, type, color, order };
  }

  async updateStatusCategory(id: string, changes: Partial<Pick<StatusCategory, 'name' | 'type' | 'color'>>): Promise<StatusCategory | undefined> {
    const existing = (await this.listStatusCategories()).find((c) => c.id === id);
    if (!existing) return undefined;
    const merged = { ...existing, ...changes };
    await this.db.updateTable('status_categories').set({ name: merged.name, type: merged.type, color: merged.color ?? null }).where('id', '=', id).execute();
    persistState();
    return merged;
  }

  async getWorkflow(): Promise<Workflow> {
    const workflowRow = (await this.db.selectFrom('workflow').selectAll().executeTakeFirst())!;
    const statuses = (await this.db.selectFrom('workflow_statuses').selectAll().where('workflow_id', '=', workflowRow.id).execute()).map(rowToWorkflowStatus);
    const transitions = (await this.db.selectFrom('workflow_transitions').selectAll().where('workflow_id', '=', workflowRow.id).execute()).map(rowToWorkflowTransition);
    return assembleWorkflow(workflowRow, statuses, transitions);
  }

  async createStatus(name: string, categoryId: string, color?: string): Promise<WorkflowStatus> {
    const id = `st_${randomUUID()}`;
    const workflow = await this.getWorkflow();
    await this.db.insertInto('workflow_statuses').values({ id, workflow_id: workflow.id, name, category_id: categoryId, color: color ?? null }).execute();
    persistState();
    return { id, name, categoryId, color };
  }

  async createTransition(name: string, toStatusId: string, fromStatusId?: string): Promise<WorkflowTransition> {
    const id = `tr_${randomUUID()}`;
    const workflow = await this.getWorkflow();
    await this.db.insertInto('workflow_transitions').values({ id, workflow_id: workflow.id, name, from_status_id: fromStatusId ?? '*', to_status_id: toStatusId, required_field_ids: null }).execute();
    persistState();
    return { id, name, fromStatusId: fromStatusId ?? '*', toStatusId };
  }

  async deleteTransition(id: string): Promise<void> {
    await this.db.deleteFrom('workflow_transitions').where('id', '=', id).execute();
    persistState();
  }
}
