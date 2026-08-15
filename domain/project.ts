import type { ComponentId, ProjectId, UserId, VersionId, WorkflowId, WorkspaceId } from './ids';

/**
 * Fixed palette every project's color is drawn from — assigned automatically at creation
 * (cycling through this list) and editable afterward from Project Settings. Shared between
 * server (default assignment) and client (rendering + the swatch picker) so both agree on
 * the same set of options.
 */
export const PROJECT_COLORS = ['#137A6E', '#6E5DC6', '#3E6FB0', '#B9791A', '#2E9E58', '#CC785C', '#946B3A', '#8A8FA3'] as const;

/**
 * Which optional pieces of process are turned on for a project — a personal/small-group
 * project can turn off whatever it doesn't need (Reporters, Story Points, etc). Purely a UI
 * declutter: turning a flag off hides that feature, it never deletes or blocks existing data,
 * and turning it back on brings everything back exactly as it was.
 */
export interface ProjectFeatureFlags {
  reporters: boolean;
  storyPoints: boolean;
  dueDates: boolean;
  timeTracking: boolean;
  priority: boolean;
  componentsAndVersions: boolean;
  sprints: boolean;
  labels: boolean;
}

export const DEFAULT_FEATURE_FLAGS: ProjectFeatureFlags = {
  reporters: true,
  storyPoints: true,
  dueDates: true,
  timeTracking: true,
  priority: true,
  componentsAndVersions: true,
  sprints: true,
  labels: true,
};

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
  /** One of {@link PROJECT_COLORS} — how this project is distinguished at a glance (sidebar list, etc). */
  color: string;
  featureFlags: ProjectFeatureFlags;
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
