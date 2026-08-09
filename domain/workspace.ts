import type { WorkspaceId } from './ids';

/** The top-level tenant everything else (projects, users, the event log) belongs to. */
export interface Workspace {
  id: WorkspaceId;
  name: string;
  /** URL-safe short name, e.g. for `workspace.example.com/{slug}`. */
  slug: string;
  createdAt: string;
}
