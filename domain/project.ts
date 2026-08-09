import type { ComponentId, ProjectId, UserId, VersionId, WorkflowId, WorkspaceId } from './ids';

/** A container for issues within a workspace — the unit most permissions and boards scope to. */
export interface Project {
  id: ProjectId;
  workspaceId: WorkspaceId;
  /** Short uppercase prefix used in issue keys, e.g. "ATL" -> "ATL-142". */
  key: string;
  name: string;
  /** Unset until someone assigns a lead — a freshly created project doesn't require one. */
  leadId?: UserId;
  /** Used for issue types that don't specify their own workflow. */
  defaultWorkflowId: WorkflowId;
  archivedAt?: string;
  createdAt: string;
}

/** A sub-team ownership grouping within a project (e.g. "Checkout", "Infra"). */
export interface Component {
  id: ComponentId;
  projectId: ProjectId;
  name: string;
  description?: string;
  leadId?: UserId;
}

/** A release/fix-version an issue can be targeted at. */
export interface ProjectVersion {
  id: VersionId;
  projectId: ProjectId;
  /** e.g. "v3.4.0". */
  name: string;
  description?: string;
  /** Planned ship date. */
  releaseDate?: string;
  /**
   * Set once actually shipped — kept distinct from {@link releaseDate} so a slipped
   * version still shows its original plan alongside what really happened, in reports.
   */
  releasedAt?: string;
  archivedAt?: string;
}
