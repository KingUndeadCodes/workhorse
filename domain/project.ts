import type { ProjectId, UserId, WorkflowId, WorkspaceId } from './ids';

/**
 * Fixed palette every project's color is drawn from — assigned automatically at creation
 * (cycling through this list) and editable afterward from Project Settings. Shared between
 * server (default assignment) and client (rendering + the swatch picker) so both agree on
 * the same set of options.
 */
/* #6E5DC6 (purple) replaced with #B5527A (rose) — see docs/ui-style-guide.md rule 2 and
   app/src/app.css's --epic-b, which got the same swap for the same reason. Expanded from 8 to
   14 entries so two unrelated projects (or, via app/src/lib/util.ts's avatarColor, two
   unrelated users) are less likely to land on an identical color once a workspace has more
   than a handful — still a curated finite list, not procedural generation, and still entirely
   outside the purple/black family. */
export const PROJECT_COLORS = [
  '#137A6E', '#B5527A', '#3E6FB0', '#B9791A', '#2E9E58', '#CC785C', '#946B3A', '#8A8FA3',
  '#C9A227', '#5A7D5A', '#5C7A89', '#A64B4B', '#3F9BBE', '#7A6C5D',
] as const;

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
  sprints: boolean;
  labels: boolean;
}

export const DEFAULT_FEATURE_FLAGS: ProjectFeatureFlags = {
  reporters: true,
  storyPoints: true,
  dueDates: true,
  timeTracking: true,
  priority: true,
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

