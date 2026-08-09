import type { BoardId, FieldId, ProjectId, SavedViewId, StatusId, UserId, WorkspaceId } from './ids';

export type BoardType = 'kanban' | 'scrum';

/** One column on a {@link Board}. */
export interface BoardColumn {
  id: string;
  name: string;
  /** One column can absorb several workflow statuses. */
  statusIds: StatusId[];
  wipLimit?: number;
}

/** A Kanban/Scrum view over a filtered set of issues. */
export interface Board {
  id: BoardId;
  projectId: ProjectId;
  name: string;
  type: BoardType;
  /** Defines which issues can appear on this board. */
  filterId: SavedViewId;
  columns: BoardColumn[];
  swimlaneBy?: 'epic' | 'assignee' | 'priority' | FieldId;
}

export type FilterOp = '=' | '!=' | 'in' | 'notIn' | '>' | '<' | 'contains' | 'isEmpty';

/**
 * A structured filter tree, e.g.
 * `{ all: [{ field: 'project', op: '=', value: 'ATL' }, { any: [...] }] }`.
 */
export type FilterQuery =
  | { all: FilterQuery[] }
  | { any: FilterQuery[] }
  | { field: string; op: FilterOp; value: unknown };

/** A named, optionally shared, saved search — what a {@link Board} filters through. */
export interface SavedView {
  id: SavedViewId;
  workspaceId: WorkspaceId;
  name: string;
  /** Unset for views created as part of default setup rather than by a specific person. */
  ownerId?: UserId;
  isShared: boolean;
  query: FilterQuery;
}
