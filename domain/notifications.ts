import type { EventSubscription } from './subscription';
import type { UserId, WebhookId, WorkspaceId } from './ids';

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
  /** Used to HMAC-sign each delivery so receivers can verify authenticity. */
  secret: string;
  enabled: boolean;
  createdBy: UserId;
}
