import type { EventEnvelope, Issue, User } from '../domain';
import type { UserRepository } from '../repositories/UserRepository';
import type { WorkflowRepository } from '../repositories/WorkflowRepository';

/** How much of a comment body to surface in a `commented`/`mentioned` notification — enough to recognize the comment, not the whole thing. */
const COMMENT_PREVIEW_LENGTH = 140;

/** Everything a stored `Notification` row needs layered on top of it to render and link
 *  correctly — resolved fresh from the triggering event and its issue rather than stored on
 *  the row itself, so a later rename/status-rename is reflected automatically. */
export interface NotificationContext {
  issueKey?: string;
  issueTitle?: string;
  projectId?: string;
  /** Display name of whoever caused the triggering event — `undefined` for an automation/system actor. */
  actorName?: string;
  /** Only set for `kind === 'statusChanged' | 'resolved'` — the status the issue moved to. */
  statusName?: string;
  /** Only set for `kind === 'commented' | 'mentioned'` — a short excerpt of the comment body. */
  commentPreview?: string;
}

/**
 * The one place a notification's display context is computed — shared by
 * `EventEngine.notifyRecipients` (enriching the row it pushes live over the socket, where the
 * triggering event and issue are already in hand) and `routes/notifications.ts` (enriching a
 * row read back later, where they have to be re-fetched by id first). Keeping this logic in
 * one function means the live-pushed version and the REST-read version of the same
 * notification can never drift into showing different text for the same row.
 */
export async function computeNotificationContext(
  event: EventEnvelope | undefined,
  issue: Issue | undefined,
  actor: User | undefined,
  workflow: WorkflowRepository,
): Promise<NotificationContext> {
  const context: NotificationContext = {
    issueKey: issue?.key,
    issueTitle: issue?.title,
    projectId: issue?.projectId,
    actorName: actor?.displayName,
  };

  const payload = event?.payload;
  if (payload && (payload.type === 'issue.statusChanged' || payload.type === 'issue.resolved')) {
    const targetStatusId = payload.type === 'issue.statusChanged' ? payload.toStatusId : payload.statusId;
    context.statusName = (await workflow.getWorkflow()).statuses.find((s) => s.id === targetStatusId)?.name;
  } else if (payload && (payload.type === 'comment.created' || payload.type === 'comment.mentioned')) {
    context.commentPreview = payload.body.length > COMMENT_PREVIEW_LENGTH ? `${payload.body.slice(0, COMMENT_PREVIEW_LENGTH)}…` : payload.body;
  }

  return context;
}

/** Resolves the `User` who caused an event, or `undefined` for an automation/system actor. */
export async function actorForEvent(event: EventEnvelope, users: UserRepository): Promise<User | undefined> {
  return event.actor.kind === 'user' ? users.getById(event.actor.userId) : undefined;
}
