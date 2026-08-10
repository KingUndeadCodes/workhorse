import { getAllEvents } from '../eventLog';
import type { IssueRepository } from '../repositories/IssueRepository';
import type { WorkspaceRepository } from '../repositories/WorkspaceRepository';

export interface AuditFinding {
  issueId: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface AuditReport {
  ranAt: string;
  eventsChecked: number;
  issuesChecked: number;
  /** Sequence numbers that broke the "strictly +1 from the previous entry" invariant. */
  sequenceGaps: number[];
  findings: AuditFinding[];
  ok: boolean;
}

interface ExpectedIssueState {
  statusId?: string;
  assigneeId?: string;
  sprintId?: string;
  loggedSeconds: number;
  watchers: Set<string>;
  commentIds: Set<string>;
  deleted: boolean;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Replays the durable event log and checks it against the operational tables for every
 * issue the log actually describes — status, assignee, sprint, logged time, watchers,
 * links, and comment set, each reconstructed purely from the events that track that field.
 * If these ever disagree, either the projector missed something or a route mutated state
 * outside the event path — both are bugs this is meant to catch.
 *
 * Deliberately does not attempt to reconstruct or verify issues from the initial seed load:
 * seeding is a bulk data load, not a sequence of commands, so those issues have no
 * `issue.created` event to replay from and are correctly absent here, not flagged.
 */
export class AuditService {
  constructor(
    private readonly workspace: WorkspaceRepository,
    private readonly issues: IssueRepository,
  ) {}

  async run(): Promise<AuditReport> {
    const workspaceId = (await this.workspace.getWorkspace()).id;
    const events = getAllEvents(workspaceId);

    const sequenceGaps: number[] = [];
    for (let i = 1; i < events.length; i++) {
      if (events[i].sequence !== events[i - 1].sequence + 1) sequenceGaps.push(events[i].sequence);
    }

    const expectedByIssue = new Map<string, ExpectedIssueState>();
    const ensure = (issueId: string): ExpectedIssueState => {
      let e = expectedByIssue.get(issueId);
      if (!e) {
        e = { loggedSeconds: 0, watchers: new Set(), commentIds: new Set(), deleted: false };
        expectedByIssue.set(issueId, e);
      }
      return e;
    };

    // Tracked separately from ExpectedIssueState: a link touches two issues, and
    // `issue.unlinked` only carries the id of whichever side removed it, not both — so
    // membership has to be resolved from this table at the end, not accumulated per-issue
    // while scanning.
    const activeLinks = new Map<string, { source: string; target: string }>();

    for (const event of events) {
      const p = event.payload;
      switch (p.type) {
        case 'issue.created': {
          const e = ensure(p.issueId);
          e.statusId = p.issue.statusId;
          e.assigneeId = p.issue.assigneeId;
          e.sprintId = p.issue.sprintId;
          break;
        }
        case 'issue.statusChanged':
          ensure(p.issueId).statusId = p.toStatusId;
          break;
        case 'issue.assigned':
          ensure(p.issueId).assigneeId = p.toUserId;
          break;
        case 'issue.sprintChanged':
          ensure(p.issueId).sprintId = p.toSprintId;
          break;
        case 'issue.watcherAdded':
          ensure(p.issueId).watchers.add(p.userId);
          break;
        case 'issue.watcherRemoved':
          ensure(p.issueId).watchers.delete(p.userId);
          break;
        case 'issue.worklogAdded':
          ensure(p.issueId).loggedSeconds += p.timeSpentSeconds;
          break;
        case 'issue.linked':
          activeLinks.set(p.linkId, { source: p.issueId, target: p.linkedIssueId });
          break;
        case 'issue.unlinked':
          activeLinks.delete(p.linkId);
          break;
        case 'comment.created':
          ensure(p.issueId).commentIds.add(p.commentId);
          break;
        case 'issue.deleted':
          ensure(p.issueId).deleted = true;
          break;
        default:
          break;
      }
    }

    const findings: AuditFinding[] = [];
    const actualIssues = await this.issues.list();
    const actualIssueIds = new Set(actualIssues.map((i) => i.id));

    for (const [issueId, expected] of expectedByIssue) {
      if (expected.deleted) {
        if (actualIssueIds.has(issueId)) findings.push({ issueId, field: 'existence', expected: 'deleted', actual: 'present' });
        continue;
      }
      const actual = actualIssues.find((i) => i.id === issueId);
      if (!actual) {
        findings.push({ issueId, field: 'existence', expected: 'present', actual: 'missing' });
        continue;
      }

      if (expected.statusId !== undefined && expected.statusId !== actual.statusId) findings.push({ issueId, field: 'statusId', expected: expected.statusId, actual: actual.statusId });
      if ((expected.assigneeId ?? undefined) !== actual.assigneeId) findings.push({ issueId, field: 'assigneeId', expected: expected.assigneeId, actual: actual.assigneeId });
      if ((expected.sprintId ?? undefined) !== actual.sprintId) findings.push({ issueId, field: 'sprintId', expected: expected.sprintId, actual: actual.sprintId });
      if (expected.loggedSeconds !== actual.loggedSeconds) findings.push({ issueId, field: 'loggedSeconds', expected: expected.loggedSeconds, actual: actual.loggedSeconds });

      const actualWatchers = new Set((await this.issues.listWatchersFor(issueId)).map((w) => w.userId));
      if (!setsEqual(expected.watchers, actualWatchers)) findings.push({ issueId, field: 'watchers', expected: [...expected.watchers], actual: [...actualWatchers] });

      const expectedLinkIds = new Set([...activeLinks.entries()].filter(([, l]) => l.source === issueId || l.target === issueId).map(([linkId]) => linkId));
      const actualLinkIds = new Set((await this.issues.listLinksFor(issueId)).map((l) => l.id));
      if (!setsEqual(expectedLinkIds, actualLinkIds)) findings.push({ issueId, field: 'links', expected: [...expectedLinkIds], actual: [...actualLinkIds] });

      const actualCommentIds = new Set((await this.issues.listCommentsFor(issueId)).map((c) => c.id));
      if (!setsEqual(expected.commentIds, actualCommentIds)) findings.push({ issueId, field: 'comments', expected: [...expected.commentIds], actual: [...actualCommentIds] });
    }

    return {
      ranAt: new Date().toISOString(),
      eventsChecked: events.length,
      issuesChecked: expectedByIssue.size,
      sequenceGaps,
      findings,
      ok: sequenceGaps.length === 0 && findings.length === 0,
    };
  }
}
