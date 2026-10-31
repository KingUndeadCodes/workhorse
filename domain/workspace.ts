import type { WorkspaceId } from './ids';

/** The top-level tenant everything else (projects, users, the event log) belongs to. */
export interface Workspace {
  id: WorkspaceId;
  name: string;
  /** URL-safe short name, e.g. for `workspace.example.com/{slug}`. */
  slug: string;
  createdAt: string;
  featureFlags: WorkspaceFeatureFlags;
}

/**
 * Optional modules an owner/admin can switch off for the whole workspace. Off means off: the
 * server rejects the module's routes and its background work (agent runs, automation rules,
 * webhook deliveries) stops, and the UI hides its entry points. Turning one off never deletes
 * its data. Core features (boards, backlog, issues, comments) are deliberately not switchable.
 */
export interface WorkspaceFeatureFlags {
  agents: boolean;
  automations: boolean;
  webhooks: boolean;
  insights: boolean;
  git: boolean;
}

export const DEFAULT_WORKSPACE_FEATURE_FLAGS: WorkspaceFeatureFlags = {
  agents: true,
  automations: true,
  webhooks: true,
  insights: true,
  git: true,
};
