import type { FieldId, StatusCategoryId, StatusId, WorkflowId, WorkspaceId } from './ids';

/**
 * The small fixed set a {@link StatusCategory}'s math is anchored to. Boards use it to
 * decide which side of "started" a column falls on; cycle-time/velocity/epic-progress use
 * it to decide what counts as done. Everything else about a category — its name, its
 * color, how many of them exist — is workspace-defined and open-ended (see
 * {@link StatusCategory}).
 */
export type StatusCategoryType = 'todo' | 'inProgress' | 'done';

/**
 * A named step teams can add freely, e.g. "In Review" or "Resolving Differences" — both
 * would be type `'inProgress'` but are distinct, orderable categories. Every workspace is
 * seeded with one category per {@link StatusCategoryType} (To Do / In Progress / Done);
 * those are ordinary rows here, not special-cased, so they can be renamed, recolored, or
 * joined by more categories of the same type.
 */
export interface StatusCategory {
  id: StatusCategoryId;
  workspaceId: WorkspaceId;
  name: string;
  type: StatusCategoryType;
  color?: string;
  /** Left-to-right position across ALL categories — drives board column order and epic/sprint progress bars. */
  order: number;
}

/** One state a {@link Workflow} can put an issue in, e.g. "Blocked", "In Review", "Ready for QA". */
export interface WorkflowStatus {
  id: StatusId;
  name: string;
  categoryId: StatusCategoryId;
  /** Per-status override; falls back to the category's color when unset. */
  color?: string;
}

/** A side effect a {@link WorkflowTransition} triggers automatically when it fires. */
export interface WorkflowPostFunction {
  type: 'assignTo' | 'clearField' | 'setField' | 'notify';
  params: Record<string, unknown>;
}

/** A legal move from one {@link WorkflowStatus} to another within a {@link Workflow}. */
export interface WorkflowTransition {
  id: string;
  /** e.g. "Start Review". */
  name: string;
  /** `'*'` = allowed from any status. */
  fromStatusId: StatusId | '*';
  toStatusId: StatusId;
  /** Validator: blocks the transition until these fields are set. */
  requiredFieldIds?: FieldId[];
  postFunctions?: WorkflowPostFunction[];
}

/** The full set of statuses and legal transitions between them for one or more issue types. */
export interface Workflow {
  id: WorkflowId;
  name: string;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
  initialStatusId: StatusId;
}
