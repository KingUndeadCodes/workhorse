import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { assembleBoard, rowToSavedView, rowToSprint } from '../db/mappers';
import type { Board, SavedView, Sprint, WorkflowStatus } from '../domain';

/** Reads/writes for sprints, the board, and saved views/filters. */
export class PlanningRepository {
  constructor(private readonly db: Kysely<DB>) {}

  // ---- Sprints ----

  async listSprints(projectId: string): Promise<Sprint[]> {
    return (await this.db.selectFrom('sprints').selectAll().where('project_id', '=', projectId).execute()).map(rowToSprint);
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

  async getBoard(projectId: string): Promise<Board> {
    return assembleBoard((await this.db.selectFrom('board').selectAll().where('project_id', '=', projectId).executeTakeFirst())!);
  }

  async listBoards(): Promise<Board[]> {
    return (await this.db.selectFrom('board').selectAll().execute()).map(assembleBoard);
  }

  /** Seeds a new project's board: one column per workflow status, mirroring seed.ts's shape, plus its own saved_views filter row. */
  async createBoardForProject(projectId: string, workspaceId: string, statuses: WorkflowStatus[]): Promise<Board> {
    const boardId = `board_${randomUUID()}`;
    const filterId = `view_${randomUUID()}`;
    const board: Board = {
      id: boardId,
      projectId,
      name: 'Board',
      type: 'scrum',
      filterId,
      swimlaneBy: 'epic',
      columns: statuses.map((s) => ({ id: `col_${randomUUID()}`, name: s.name, statusIds: [s.id] })),
    };
    await this.db
      .insertInto('board')
      .values({ id: board.id, project_id: board.projectId, name: board.name, type: board.type, filter_id: board.filterId, swimlane_by: board.swimlaneBy ?? null, columns: JSON.stringify(board.columns) })
      .execute();
    await this.db.insertInto('saved_views').values({ id: filterId, workspace_id: workspaceId, name: 'Board default', owner_id: null, is_shared: 1, query: JSON.stringify({ all: [] }) }).execute();
    persistState();
    return board;
  }

  /**
   * Adds `statusId` to whichever existing board column already holds another status from
   * `categoryId` — so a new workflow status (e.g. a custom "In Review" under the
   * In Progress category) actually shows up on the board instead of silently having
   * nowhere to render. A status whose category has no column yet (a genuinely new
   * category) is left alone; that's a real "add a column" decision, not something to guess at.
   *
   * The workflow is shared across every project (see domain/workflow.ts's doc comment), but
   * each project has its own board — so a new status must be fanned out to every project's
   * board, not just one, or a second project's board would silently never gain the column.
   */
  async addStatusToMatchingColumn(statusId: string, categoryId: string, statusCategoryById: Map<string, string>): Promise<void> {
    for (const board of await this.listBoards()) {
      const column = board.columns.find((col) => col.statusIds.some((id) => statusCategoryById.get(id) === categoryId));
      if (!column || column.statusIds.includes(statusId)) continue;
      const columns = board.columns.map((col) => (col.id === column.id ? { ...col, statusIds: [...col.statusIds, statusId] } : col));
      await this.db.updateTable('board').set({ columns: JSON.stringify(columns) }).where('id', '=', board.id).execute();
    }
    persistState();
  }

  /** Removes a deleted status from every board column's `statusIds`, across every project's board — the mirror of {@link addStatusToMatchingColumn}. */
  async removeStatusFromColumns(statusId: string): Promise<void> {
    for (const board of await this.listBoards()) {
      if (!board.columns.some((col) => col.statusIds.includes(statusId))) continue;
      const columns = board.columns.map((col) => ({ ...col, statusIds: col.statusIds.filter((id) => id !== statusId) }));
      await this.db.updateTable('board').set({ columns: JSON.stringify(columns) }).where('id', '=', board.id).execute();
    }
    persistState();
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
