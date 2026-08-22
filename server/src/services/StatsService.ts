import { getAllEvents } from '../eventLog';
import type { IssueRepository } from '../repositories/IssueRepository';
import type { WorkspaceRepository } from '../repositories/WorkspaceRepository';
import { issueIdFromPayload } from './EventEngine';
import type { ActiveTicket, StatsWindow, TimeSpentBucket, WindowStats, WorkspaceStats } from '../domain';

const TOP_TICKETS_LIMIT = 10;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Per-window bucket granularity and count — `bucketMs * bucketCount` is also this window's
 * activity cutoff, so "how far back we count activity" and "how far back the chart spans"
 * always agree. */
const WINDOW_CONFIG: Record<StatsWindow, { bucketMs: number; bucketCount: number }> = {
  '24h': { bucketMs: HOUR_MS, bucketCount: 24 },
  '1w': { bucketMs: DAY_MS, bucketCount: 7 },
  '30d': { bucketMs: DAY_MS, bucketCount: 30 },
};

const WINDOWS: StatsWindow[] = ['24h', '1w', '30d'];

function floorToBucket(ts: number, bucketMs: number): number {
  return Math.floor(ts / bucketMs) * bucketMs;
}

/** `bucketCount` bucket-start timestamps, `bucketMs` apart, ending at the bucket containing `now` — pre-filled so the client never has to interpolate gaps. */
function bucketStarts(now: number, bucketMs: number, bucketCount: number): number[] {
  const nowBucket = floorToBucket(now, bucketMs);
  return Array.from({ length: bucketCount }, (_, i) => nowBucket - (bucketCount - 1 - i) * bucketMs);
}

/**
 * Workspace-wide activity/time-spent report, computed fresh on every call — one pass over the
 * full event log (same `getAllEvents` call {@link AuditService} already makes, "fine at this
 * app's scale") plus one pass over every worklog, for all three windows at once so the client's
 * 24h/1w/30d toggle never needs a refetch.
 */
export class StatsService {
  constructor(
    private readonly workspace: WorkspaceRepository,
    private readonly issues: IssueRepository,
  ) {}

  async run(): Promise<WorkspaceStats> {
    const workspaceId = (await this.workspace.getWorkspace()).id;
    const events = getAllEvents(workspaceId);
    const worklogs = await this.issues.listAllWorklogs();
    const allIssues = await this.issues.listAll();
    const issuesById = new Map(allIssues.map((i) => [i.id, i]));

    const now = Date.now();
    const cutoffs: Record<StatsWindow, number> = {
      '24h': now - WINDOW_CONFIG['24h'].bucketMs * WINDOW_CONFIG['24h'].bucketCount,
      '1w': now - WINDOW_CONFIG['1w'].bucketMs * WINDOW_CONFIG['1w'].bucketCount,
      '30d': now - WINDOW_CONFIG['30d'].bucketMs * WINDOW_CONFIG['30d'].bucketCount,
    };

    const activityCounts: Record<StatsWindow, Map<string, number>> = { '24h': new Map(), '1w': new Map(), '30d': new Map() };
    for (const event of events) {
      // `comment.mentioned` echoes the same action `comment.created` already counts (once per
      // person mentioned) — including it would double/triple-count a single comment.
      if (event.payload.type === 'comment.mentioned') continue;
      const issueId = event.subject.type === 'issue' ? event.subject.id : issueIdFromPayload(event.payload);
      if (!issueId) continue;
      const occurredAtMs = new Date(event.occurredAt).getTime();
      for (const window of WINDOWS) {
        if (occurredAtMs < cutoffs[window]) continue;
        const counts = activityCounts[window];
        counts.set(issueId, (counts.get(issueId) ?? 0) + 1);
      }
    }

    const timeSpentBuckets: Record<StatsWindow, Map<number, number>> = { '24h': new Map(), '1w': new Map(), '30d': new Map() };
    const totalSecondsLogged: Record<StatsWindow, number> = { '24h': 0, '1w': 0, '30d': 0 };
    for (const worklog of worklogs) {
      const startedAtMs = new Date(worklog.startedAt).getTime();
      for (const window of WINDOWS) {
        if (startedAtMs < cutoffs[window]) continue;
        const { bucketMs } = WINDOW_CONFIG[window];
        const bucket = floorToBucket(startedAtMs, bucketMs);
        const buckets = timeSpentBuckets[window];
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + worklog.timeSpentSeconds);
        totalSecondsLogged[window] += worklog.timeSpentSeconds;
      }
    }

    const windows = {} as Record<StatsWindow, WindowStats>;
    for (const window of WINDOWS) {
      const mostActiveTickets: ActiveTicket[] = [...activityCounts[window].entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_TICKETS_LIMIT)
        .map(([issueId, eventCount]) => {
          const issue = issuesById.get(issueId);
          return issue ? { issueId, issueKey: issue.key, issueTitle: issue.title, projectId: issue.projectId, eventCount } : undefined;
        })
        .filter((t): t is ActiveTicket => t !== undefined);

      const { bucketMs, bucketCount } = WINDOW_CONFIG[window];
      const buckets = timeSpentBuckets[window];
      const timeSpentBucketsList: TimeSpentBucket[] = bucketStarts(now, bucketMs, bucketCount).map((bucketStart) => ({
        bucketStart: new Date(bucketStart).toISOString(),
        totalSeconds: buckets.get(bucketStart) ?? 0,
      }));

      windows[window] = { mostActiveTickets, timeSpentBuckets: timeSpentBucketsList, totalSecondsLogged: totalSecondsLogged[window] };
    }

    return { computedAt: new Date().toISOString(), windows };
  }
}
