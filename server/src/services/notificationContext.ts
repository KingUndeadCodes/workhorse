import type { ActorRef, EventEnvelope, Issue, User } from '../domain';
import type { UserRepository } from '../repositories/UserRepository';
import type { WorkflowRepository } from '../repositories/WorkflowRepository';

/** How much of a comment body to surface in a `commented`/`mentioned` notification — enough to recognize the comment (the panel clamps it to a couple of lines), not the whole thing. */
const COMMENT_PREVIEW_LENGTH = 200;

/** Everything a stored `Notification` row needs layered on top of it to render and link
 *  correctly — resolved fresh from the triggering event and its issue rather than stored on
 *  the row itself, so a later rename/status-rename is reflected automatically. */
export interface NotificationContext {
  issueKey?: string;
  issueTitle?: string;
  projectId?: string;
  /** Display name of whoever caused the triggering event — `undefined` for an automation/system actor. */
  actorName?: string;
  /** Id of that user, so the client can render their avatar from the users it already has (the picture itself is deliberately not sent: it can be megabytes). */
  actorId?: string;
  /** Whether a person (or agent), an automation rule or the system caused it — how the panel labels an actor with no user behind it. */
  actorKind?: ActorRef['kind'];
  /** Only set for `kind === 'statusChanged' | 'resolved'` — the status the issue moved to. */
  statusName?: string;
  /** Only set for `kind === 'statusChanged'` — the status it moved from, so the panel can show "To Do → In Progress". */
  fromStatusName?: string;
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
    actorId: actor?.id,
    actorKind: event?.actor.kind,
  };

  const payload = event?.payload;
  if (payload && (payload.type === 'issue.statusChanged' || payload.type === 'issue.resolved')) {
    const statuses = (await workflow.getWorkflow()).statuses;
    const nameOf = (id: string) => statuses.find((s) => s.id === id)?.name;
    context.statusName = nameOf(payload.type === 'issue.statusChanged' ? payload.toStatusId : payload.statusId);
    if (payload.type === 'issue.statusChanged') context.fromStatusName = nameOf(payload.fromStatusId);
  } else if (payload && (payload.type === 'comment.created' || payload.type === 'comment.mentioned')) {
    context.commentPreview = payload.body.length > COMMENT_PREVIEW_LENGTH ? `${payload.body.slice(0, COMMENT_PREVIEW_LENGTH)}…` : payload.body;
  }

  return context;
}

/** Resolves the `User` who caused an event, or `undefined` for an automation/system actor. */
export async function actorForEvent(event: EventEnvelope, users: UserRepository): Promise<User | undefined> {
  return event.actor.kind === 'user' ? users.getById(event.actor.userId) : undefined;
}
