import type { FieldValue } from './field';
import type {
  ComponentId,
  IssueId,
  IssueTypeId,
  LabelId,
  LinkId,
  ProjectId,
  SprintId,
  StatusId,
  UserId,
  VersionId,
  WorkflowId,
} from './ids';

export type IssuePriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

/** The only story point values an issue may be estimated at — a fixed Fibonacci-ish scale, not a free-form number. */
export const STORY_POINT_VALUES = [1, 2, 3, 5, 8, 13] as const;

/** A workspace- or project-defined kind of issue, e.g. "Story", "Bug", "Task", "Epic". */
export interface IssueType {
  id: IssueTypeId;
  /** `null` = available workspace-wide. */
  projectId: ProjectId | null;
  name: string;
  icon?: string;
  color?: string;
  workflowId: WorkflowId;
  /** Subtask-type issues must set {@link Issue.parentId}. */
  isSubtaskType: boolean;
}

export type IssueLinkType = 'blocks' | 'duplicates' | 'relatesTo' | 'clones' | 'causes';

/**
 * A typed relationship between two issues, stored once and directionally:
 * `sourceIssueId <type> targetIssueId`, e.g. "A blocks B". The inverse label ("is blocked
 * by") is derived for display on B, not stored separately.
 */
export interface IssueLink {
  id: LinkId;
  type: IssueLinkType;
  sourceIssueId: IssueId;
  targetIssueId: IssueId;
  createdAt: string;
  createdBy: UserId;
}

export interface Label {
  id: LabelId;
  name: string;
  color?: string;
}

/** Block-based rich text; the editor owns the shape of {@link content}. */
export interface RichText {
  format: 'richtext-v1';
  content: unknown;
  /** Flattened plain text, for search indexing. */
  plainText: string;
}

/** The central work-item entity — a story, bug, task, epic, or subtask. */
export interface Issue {
  id: IssueId;
  /** Project key + sequence, e.g. "ATL-142". */
  key: string;
  projectId: ProjectId;
  issueTypeId: IssueTypeId;
  statusId: StatusId;
  title: string;
  description?: RichText;
  priority: IssuePriority;
  reporterId: UserId;
  /** Accountable owners — humans only. AI agents are never assignees, see {@link agentAssignments}. */
  assigneeIds: UserId[];
  /**
   * AI agents working this issue, each mapped to the human {@link assigneeIds} entry they act
   * on behalf of. An agent may only be attached here on behalf of a *current* assignee — if
   * that assignee is removed, the agent's entry is removed with them. This is what guarantees
   * an agent's actions are always attributable to a real assigned user (see {@link ActorRef}).
   */
  agentAssignments?: Partial<Record<UserId, UserId>>;

  /**
   * Primary hierarchy parent (epic -> story -> subtask, etc). Nesting depth is not fixed
   * to two levels — a subtask's parent can itself have a parent.
   */
  parentId?: IssueId;
  /**
   * Secondary parent links, for issues that legitimately belong to more than one
   * epic/initiative. Rollups (e.g. epic progress) should treat {@link parentId} as primary.
   */
  additionalParentIds?: IssueId[];

  labelIds: LabelId[];
  componentIds: ComponentId[];
  fixVersionIds: VersionId[];
  sprintId?: SprintId;

  /** Must be one of {@link STORY_POINT_VALUES} — enforced wherever this is written, not just presented as options in the UI. */
  storyPoints?: number;
  originalEstimateSeconds?: number;
  remainingEstimateSeconds?: number;
  /** Denormalized sum of `Worklog` entries, kept in sync on write. */
  loggedSeconds: number;

  fieldValues: FieldValue[];

  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  /** Set when `statusId`'s category becomes `'done'`, cleared if reopened. */
  resolvedAt?: string;
}
