import type { EventType } from './events';
import type { EventSubscription } from './subscription';
import type { EventId, IssueId, NotificationId, UserId, WebhookDeliveryId, WebhookId, WorkspaceId } from './ids';

/**
 * The single external-listener primitive — everything that reacts to the log from outside
 * the system (third-party integrations, and now notification delivery itself: email,
 * in-app, Slack, SMS, whatever) is one of these, undifferentiated. This domain doesn't
 * model "notification mediums," per-user delivery preferences, or how a target
 * address/channel is resolved — a subscriber owns all of that itself once it's receiving
 * events. Turning an event into an actual delivered notification is entirely the
 * receiving service's job, not something this type prescribes.
 *
 * It implements only the listening protocol ({@link EventSubscription}, shared with
 * `AutomationRule` and `Agent`) and nothing else — there is no acting protocol here,
 * because unlike `Agent` it never mutates this system's state directly. It receives
 * events; what it does with them is entirely its own business.
 */
export interface WebhookSubscription extends EventSubscription {
  id: WebhookId;
  workspaceId: WorkspaceId;
  targetUrl: string;
  /** Used to HMAC-sign each delivery so receivers can verify authenticity. Never returned to the client except once, on creation — see {@link WebhookSubscriptionPublic}. */
  secret: string;
  enabled: boolean;
  createdBy: UserId;
}

/** What every route except creation must return — `secret` is a write-once credential, not something every workspace member should be able to read back out. */
export type WebhookSubscriptionPublic = Omit<WebhookSubscription, 'secret'>;

export type WebhookDeliveryStatus = 'success' | 'failure';

/**
 * One outbound delivery attempt for a {@link WebhookSubscription} — write-once, created right
 * after the attempt resolves (see `EventEngine.deliverToWebhook`). Unlike a `Notification`,
 * nothing about a delivery ever changes after it's recorded, so there's no read/unread-style
 * mutable state here. `status` drives the same `.status-{status}` UI pattern the Agent run
 * history already uses.
 */
export interface WebhookDelivery {
  id: WebhookDeliveryId;
  webhookId: WebhookId;
  eventId: EventId;
  /** Denormalized from the triggering event at write time — stable once written, so reading
   *  a delivery list doesn't need to re-fetch the event log entry per row. */
  eventType: EventType;
  status: WebhookDeliveryStatus;
  /** The HTTP response status code, when a response was received at all — absent for a
   *  network error or timeout, where `error` carries the reason instead. */
  statusCode?: number;
  error?: string;
  createdAt: string;
}

/**
 * Discriminates a {@link Notification} by which triggering `EventType` produced it — see
 * `EventEngine`'s `notificationKindFor`, the one place the mapping from event type to kind is
 * decided. Kept as its own small closed set rather than reusing `EventType` directly: only a
 * handful of event types are ever notification-worthy, and a UI row needs one short word to
 * pick an icon/phrasing by, not the full event vocabulary.
 */
export type NotificationKind = 'assigned' | 'statusChanged' | 'resolved' | 'commented' | 'mentioned';

/**
 * One in-app, per-recipient notification — this is the one concrete "notification medium"
 * this domain actually implements as a first-class stored entity, unlike the deliberately
 * unopinionated {@link WebhookSubscription} above. It needs to be a stored row rather than a
 * fire-and-forget delivery precisely because it carries read/unread state per recipient,
 * something a webhook (which has no notion of "seen") never needs.
 *
 * Populated the same way automations/agents are: a step alongside them that resolves who a
 * qualifying event is *about* (an issue's reporter, its assignees, an @-mentioned user) and
 * inserts one row per recipient — never the actor who caused their own event. See
 * `EventEngine`'s `notifyRecipients`.
 */
export interface Notification {
  id: NotificationId;
  workspaceId: WorkspaceId;
  recipientUserId: UserId;
  /** The event that caused this notification — kept for traceability (and so a route can enrich a row with who/what at read time without duplicating that data into every row). */
  eventId: EventId;
  issueId: IssueId;
  kind: NotificationKind;
  read: boolean;
  readAt?: string;
  createdAt: string;
}
