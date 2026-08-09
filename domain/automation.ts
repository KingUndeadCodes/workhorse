import type { FilterOp } from './board';
import type { EventSubscription } from './subscription';
import type { AutomationRuleId, FieldId, ProjectId, StatusId, UserId } from './ids';

/** A single condition an {@link AutomationRule} must satisfy before its actions run. */
export interface AutomationCondition {
  field: string;
  op: FilterOp;
  value: unknown;
}

/**
 * A mutation an {@link AutomationRule} (or {@link Agent}) may perform.
 *
 * No dedicated "send a notification" action: that would presume an internal delivery
 * pipeline this domain no longer has (notifications.ts). An automation that wants to say
 * something human-readable posts a comment instead — real, visible content that also
 * emits `comment.created` for any external listener to treat as notification-worthy.
 */
export type AutomationAction =
  | { type: 'transitionStatus'; toStatusId: StatusId }
  | { type: 'assignTo'; userId: UserId }
  | { type: 'addComment'; body: string }
  | { type: 'setField'; fieldId: FieldId; value: unknown };

/**
 * A no-code rule: what it hears is {@link EventSubscription} — the listening protocol
 * shared with `Agent` and `WebhookSubscription`. What it may do in response is bounded to
 * {@link AutomationAction}: the same acting protocol `Agent` is bound by, since a rule
 * mutates real state just like one.
 */
export interface AutomationRule extends EventSubscription {
  id: AutomationRuleId;
  /** `null` = workspace-wide. */
  projectId: ProjectId | null;
  name: string;
  enabled: boolean;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}
