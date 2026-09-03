/**
 * Identifier aliases for every entity in the domain. Each is a plain `string` at the type
 * level — the distinct names exist so a function signature reads as "takes an IssueId,
 * not just any string," not to enforce anything at runtime.
 */

export type WorkspaceId = string;
export type UserId = string;
export type ProjectId = string;
export type IssueId = string;
export type IssueTypeId = string;
export type WorkflowId = string;
export type StatusId = string;
export type StatusCategoryId = string;
export type FieldId = string;
export type SprintId = string;
export type BoardId = string;
export type LabelId = string;
export type ComponentId = string;
export type VersionId = string;
export type CommentId = string;
export type AttachmentId = string;
export type LinkId = string;
export type AutomationRuleId = string;
export type SavedViewId = string;
export type EventId = string;
export type WebhookId = string;
export type AgentRunId = string;
export type WorklogId = string;
export type GitRepoLinkId = string;
export type BranchId = string;
export type NotificationId = string;
export type WebhookDeliveryId = string;
