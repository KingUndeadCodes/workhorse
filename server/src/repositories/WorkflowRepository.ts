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

  /**
   * Deletes a status category. Categories of type `todo`/`done` are the workflow's fixed
   * boundaries (every issue has to start and end somewhere) and can never be removed —
   * `inProgress` categories are the customizable middle of the workflow. Also refuses to
   * delete a category that still has statuses in it, so a status can't be silently
   * orphaned — move or delete its statuses first.
   */
  async deleteStatusCategory(id: string): Promise<{ error?: string }> {
    const category = (await this.listStatusCategories()).find((c) => c.id === id);
    if (!category) return { error: 'Category not found' };
    if (category.type !== 'inProgress') return { error: `The ${category.type === 'todo' ? 'To Do' : 'Done'} category can't be deleted` };
    const workflow = await this.getWorkflow();
    if (workflow.statuses.some((s) => s.categoryId === id)) return { error: 'Move or delete this category’s statuses first' };
    await this.db.deleteFrom('status_categories').where('id', '=', id).execute();
    persistState();
    return {};
  }

  /**
   * True if every `todo`-category status has a directed path (via transitions — a `*`
   * "from any status" transition counts as an edge from every status) to at least one
   * `done`-category status. Used to veto any edit that would leave an issue able to start
   * in To Do with no sequence of transitions that ever reaches Done.
   */
  private hasPathFromEveryTodoToDone(statuses: WorkflowStatus[], categoriesById: Map<string, StatusCategory>, transitions: WorkflowTransition[]): boolean {
    const todoStatuses = statuses.filter((s) => categoriesById.get(s.categoryId)?.type === 'todo');
    const doneIds = new Set(statuses.filter((s) => categoriesById.get(s.categoryId)?.type === 'done').map((s) => s.id));
    if (todoStatuses.length === 0 || doneIds.size === 0) return true;

    const allIds = statuses.map((s) => s.id);
    const adjacency = new Map<string, string[]>(allIds.map((id) => [id, []]));
    for (const t of transitions) {
      if (t.fromStatusId === '*') {
        for (const id of allIds) if (id !== t.toStatusId) adjacency.get(id)?.push(t.toStatusId);
      } else {
        adjacency.get(t.fromStatusId)?.push(t.toStatusId);
      }
    }

    return todoStatuses.every((todo) => {
      const seen = new Set<string>([todo.id]);
      const stack = [todo.id];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (doneIds.has(current)) return true;
        for (const next of adjacency.get(current) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
      return false;
    });
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

  async updateStatus(id: string, changes: Partial<Pick<WorkflowStatus, 'name' | 'color'>>): Promise<WorkflowStatus | undefined> {
    const workflow = await this.getWorkflow();
    const existing = workflow.statuses.find((s) => s.id === id);
    if (!existing) return undefined;
    const merged = { ...existing, ...changes };
    await this.db.updateTable('workflow_statuses').set({ name: merged.name, color: merged.color ?? null }).where('id', '=', id).execute();
    persistState();
    return merged;
  }

  /**
   * Deletes a status. Only statuses in an `inProgress`-type category may be deleted —
   * `todo`/`done` statuses are the workflow's fixed entry/exit points. Also refuses to
   * delete a status that any issue is currently sitting in (that issue would be left
   * pointing at a status id that no longer exists), and cascades to remove any transition
   * that references the status, so the diagram doesn't end up with dangling arrows.
   */
  async deleteStatus(id: string): Promise<{ error?: string }> {
    const workflow = await this.getWorkflow();
    const status = workflow.statuses.find((s) => s.id === id);
    if (!status) return { error: 'Status not found' };
    const category = (await this.listStatusCategories()).find((c) => c.id === status.categoryId);
    if (!category || category.type !== 'inProgress') {
      return { error: `Statuses in the ${category?.type === 'done' ? 'Done' : 'To Do'} category can't be deleted` };
    }
    const inUse = await this.db.selectFrom('issues').select('id').where('status_id', '=', id).limit(1).executeTakeFirst();
    if (inUse) return { error: 'Cannot delete a status that issues are currently using' };

    const categoriesById = new Map((await this.listStatusCategories()).map((c) => [c.id, c]));
    const remainingStatuses = workflow.statuses.filter((s) => s.id !== id);
    const remainingTransitions = workflow.transitions.filter((t) => t.fromStatusId !== id && t.toStatusId !== id);
    if (!this.hasPathFromEveryTodoToDone(remainingStatuses, categoriesById, remainingTransitions)) {
      return { error: 'Deleting this status would remove the only path from To Do to Done' };
    }

    await this.db
      .deleteFrom('workflow_transitions')
      .where((eb) => eb.or([eb('from_status_id', '=', id), eb('to_status_id', '=', id)]))
      .execute();
    await this.db.deleteFrom('workflow_statuses').where('id', '=', id).execute();
    persistState();
    return {};
  }

  async createTransition(name: string, toStatusId: string, fromStatusId?: string): Promise<WorkflowTransition> {
    const id = `tr_${randomUUID()}`;
    const workflow = await this.getWorkflow();
    await this.db.insertInto('workflow_transitions').values({ id, workflow_id: workflow.id, name, from_status_id: fromStatusId ?? '*', to_status_id: toStatusId, required_field_ids: null }).execute();
    persistState();
    return { id, name, fromStatusId: fromStatusId ?? '*', toStatusId };
  }

  /** Deletes a transition, unless it's the only remaining route from some To Do status to Done. */
  async deleteTransition(id: string): Promise<{ error?: string }> {
    const workflow = await this.getWorkflow();
    const remainingTransitions = workflow.transitions.filter((t) => t.id !== id);
    const categoriesById = new Map((await this.listStatusCategories()).map((c) => [c.id, c]));
    if (!this.hasPathFromEveryTodoToDone(workflow.statuses, categoriesById, remainingTransitions)) {
      return { error: 'Deleting this transition would remove the only path from To Do to Done' };
    }
    await this.db.deleteFrom('workflow_transitions').where('id', '=', id).execute();
    persistState();
    return {};
  }
}
