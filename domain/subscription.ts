import type { EventType } from './events';

/**
 * The listening protocol: the one shape every consumer of the log —
 * `AutomationRule`, `Agent`, `WebhookSubscription` — implements to say "these are the
 * events I hear." Before this, each invented its own filter shape (a single trigger, an
 * array of triggers, a flat list). A new filtering capability (e.g. matching on payload
 * fields, not just event type) is added once, here, and every listener gets it — instead
 * of three times, three ways.
 *
 * This is only half the contract. What a listener is allowed to *do* in response is a
 * separate, second protocol that only applies to listeners that mutate real state (see
 * `AutomationAction` in automation.ts, and `Agent`'s `allowedActionTypes`/`approvalPolicy`/
 * `budget` in agent.ts) — a `WebhookSubscription` has no such constraint, because it never
 * mutates this system's state at all.
 */
export interface EventSubscription {
  eventFilter: EventType[] | '*';
  /** Cron expression; fires independently of (or alongside) `eventFilter` matches. */
  schedule?: string;
}
