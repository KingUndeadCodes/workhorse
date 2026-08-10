import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { assembleBoard, rowToSavedView, rowToSprint } from '../db/mappers';
import type { Board, SavedView, Sprint } from '../domain';

/** Reads/writes for sprints, the board, and saved views/filters. */
export class PlanningRepository {
  constructor(private readonly db: Kysely<DB>) {}

  // ---- Sprints ----

  async listSprints(): Promise<Sprint[]> {
    return (await this.db.selectFrom('sprints').selectAll().execute()).map(rowToSprint);
  }

  async getSprint(id: string): Promise<Sprint | undefined> {
    const row = await this.db.selectFrom('sprints').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToSprint(row) : undefined;
  }

  async createSprint(projectId: string, name: string, goal?: string, startDate?: string, endDate?: string): Promise<Sprint> {
    const id = `sprint_${randomUUID()}`;
    await this.db
      .insertInto('sprints')
      .values({ id, project_id: projectId, name, goal: goal ?? null, state: 'future', start_date: startDate ?? null, end_date: endDate ?? null, completed_at: null })
      .execute();
    persistState();
    return (await this.getSprint(id))!;
  }

  async startSprint(id: string): Promise<void> {
    await this.db.updateTable('sprints').set({ state: 'active' }).where('id', '=', id).execute();
  }

  async completeSprint(id: string, completedAt: string): Promise<void> {
    await this.db.updateTable('sprints').set({ state: 'closed', completed_at: completedAt }).where('id', '=', id).execute();
  }

  // ---- Board ----

  async getBoard(): Promise<Board> {
    return assembleBoard((await this.db.selectFrom('board').selectAll().executeTakeFirst())!);
  }

  // ---- Saved views ----

  async listSavedViews(): Promise<SavedView[]> {
    return (await this.db.selectFrom('saved_views').selectAll().execute()).map(rowToSavedView);
  }

  async getSavedView(id: string): Promise<SavedView | undefined> {
    const row = await this.db.selectFrom('saved_views').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToSavedView(row) : undefined;
  }

  async createSavedView(workspaceId: string, name: string, ownerId: string, isShared: boolean, query: unknown): Promise<SavedView> {
    const id = `view_${randomUUID()}`;
    await this.db
      .insertInto('saved_views')
      .values({ id, workspace_id: workspaceId, name, owner_id: ownerId, is_shared: isShared ? 1 : 0, query: JSON.stringify(query ?? { all: [] }) })
      .execute();
    persistState();
    return (await this.getSavedView(id))!;
  }

  async deleteSavedView(id: string): Promise<void> {
    await this.db.deleteFrom('saved_views').where('id', '=', id).execute();
    persistState();
  }
}
