import type { IssueId, ProjectId } from './ids';

/** How far back a workspace-stats window looks — see {@link WorkspaceStats}. */
export type StatsWindow = '24h' | '1w' | '30d';

/** One issue's rank in a window's activity leaderboard — "activity" means every event the
 * durable event log recorded against it (status changes, comments, assignments, worklogs,
 * everything), not just logged time. */
export interface ActiveTicket {
  issueId: IssueId;
  issueKey: string;
  issueTitle: string;
  projectId: ProjectId;
  eventCount: number;
}

/** One point on the time-spent chart — see {@link WindowStats.timeSpentBuckets}. */
export interface TimeSpentBucket {
  /** ISO timestamp, UTC-aligned to the bucket's start (hour or day, depending on the window). */
  bucketStart: string;
  totalSeconds: number;
}

export interface WindowStats {
  /** Sorted descending by `eventCount`, capped at a fixed top-N. */
  mostActiveTickets: ActiveTicket[];
  /** Hourly buckets for the `24h` window, daily buckets for `1w`/`30d` — every bucket in the
   * range is present (including zero-activity ones), so the client never has to interpolate gaps. */
  timeSpentBuckets: TimeSpentBucket[];
  totalSecondsLogged: number;
}

/** Workspace-wide, across every project — all three windows computed together in one pass
 * over the event log, so switching windows client-side never needs a refetch. */
export interface WorkspaceStats {
  computedAt: string;
  windows: Record<StatsWindow, WindowStats>;
}
