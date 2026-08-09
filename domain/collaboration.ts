import type { RichText } from './issue';
import type { AttachmentId, CommentId, IssueId, UserId, WorklogId } from './ids';

export interface Comment {
  id: CommentId;
  issueId: IssueId;
  authorId: UserId;
  body: RichText;
  createdAt: string;
  editedAt?: string;
}

export interface Attachment {
  id: AttachmentId;
  issueId: IssueId;
  uploadedBy: UserId;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

/** Marks a user as wanting to be notified about an issue. */
export interface Watcher {
  issueId: IssueId;
  userId: UserId;
  watchingSince: string;
}

/**
 * There is deliberately no `ActivityEvent` type here — an issue's Activity tab is a query
 * over the global event log (see events.ts):
 * `events.filter(e => e.subject.type === 'issue' && e.subject.id === issueId)` ordered by
 * sequence. Not a separately stored record, so it can never drift from what
 * automations/webhooks saw.
 */

/** A logged block of time spent on an issue. */
export interface Worklog {
  id: WorklogId;
  issueId: IssueId;
  authorId: UserId;
  timeSpentSeconds: number;
  startedAt: string;
  note?: string;
}
