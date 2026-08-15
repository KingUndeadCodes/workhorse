import type {
  Agent,
  AgentRun,
  Attachment,
  AutomationRule,
  Board,
  Branch,
  Comment,
  Component,
  FieldDefinition,
  GitRepoLink,
  GitRepoLinkPublic,
  Issue,
  IssueLink,
  IssueType,
  Label,
  Project,
  ProjectVersion,
  SavedView,
  Sprint,
  StatusCategory,
  User,
  WebhookSubscription,
  Workflow,
  WorkflowStatus,
  WorkflowTransition,
  Worklog,
  Workspace,
  WorkspaceMember,
} from '../domain';
import { DEFAULT_FEATURE_FLAGS } from '../domain';

const j = (v: unknown) => JSON.stringify(v ?? null);
const parse = <T>(v: unknown, fallback: T): T => (v === null || v === undefined || v === '' ? fallback : (JSON.parse(v as string) as T));
const bool = (v: unknown): boolean => v === 1 || v === true;
const nullish = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : (v as string));

export function rowToWorkspace(r: Record<string, unknown>): Workspace {
  return { id: r.id as string, name: r.name as string, slug: r.slug as string, createdAt: r.created_at as string };
}

export function rowToProject(r: Record<string, unknown>): Project {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    key: r.key as string,
    name: r.name as string,
    leadId: nullish(r.lead_id),
    defaultWorkflowId: r.default_workflow_id as string,
    color: r.color as string,
    featureFlags: parse(r.feature_flags, DEFAULT_FEATURE_FLAGS),
    createdAt: r.created_at as string,
    archivedAt: nullish(r.archived_at),
  };
}

export function rowToWorkspaceMember(r: Record<string, unknown>): WorkspaceMember {
  return {
    workspaceId: r.workspace_id as string,
    userId: r.user_id as string,
    role: r.role as WorkspaceMember['role'],
    joinedAt: r.joined_at as string,
  };
}

export function rowToUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string,
    kind: r.kind as User['kind'],
    email: r.email as string,
    displayName: r.display_name as string,
    avatarUrl: nullish(r.avatar_url),
    status: r.status as User['status'],
    createdAt: r.created_at as string,
  };
}

export function rowToAgent(r: Record<string, unknown>): Agent {
  return {
    userId: r.user_id as string,
    workspaceId: r.workspace_id as string,
    projectId: nullish(r.project_id) ?? null,
    name: r.name as string,
    description: nullish(r.description),
    enabled: bool(r.enabled),
    model: (r.model as string | null) ?? 'claude-haiku-4-5',
    eventFilter: parse(r.event_filter, '*' as const),
    allowedActionTypes: parse(r.allowed_action_types, []),
    approvalPolicy: parse(r.approval_policy, { mode: 'autoApplyAll' as const }),
    budget: parse(r.budget, {}),
    ignoreSelfTriggeredEvents: bool(r.ignore_self_triggered_events),
    createdAt: r.created_at as string,
  };
}
export function agentParams(a: Agent): unknown[] {
  return [a.userId, a.workspaceId, a.projectId, a.name, a.description ?? null, a.enabled ? 1 : 0, a.model, j(a.eventFilter), j(a.allowedActionTypes), j(a.approvalPolicy), j(a.budget), a.ignoreSelfTriggeredEvents ? 1 : 0, a.createdAt];
}

export function rowToAgentRun(r: Record<string, unknown>): AgentRun {
  return {
    id: r.id as string,
    agentUserId: r.agent_user_id as string,
    triggeringEventId: r.triggering_event_id as string,
    issueId: r.issue_id as string,
    status: r.status as AgentRun['status'],
    proposedActions: parse(r.proposed_actions, []),
    appliedActionIndexes: parse(r.applied_action_indexes, undefined),
    rationale: nullish(r.rationale),
    reviewedBy: nullish(r.reviewed_by),
    reviewedAt: nullish(r.reviewed_at),
    startedAt: r.started_at as string,
    completedAt: nullish(r.completed_at),
    failureReason: nullish(r.failure_reason),
    tokenUsage: (r.token_usage as number | null) ?? undefined,
  };
}
export function agentRunParams(run: AgentRun): unknown[] {
  return [
    run.id,
    run.agentUserId,
    run.triggeringEventId,
    run.issueId,
    run.status,
    j(run.proposedActions),
    j(run.appliedActionIndexes ?? null),
    run.rationale ?? null,
    run.reviewedBy ?? null,
    run.reviewedAt ?? null,
    run.startedAt,
    run.completedAt ?? null,
    run.failureReason ?? null,
    run.tokenUsage ?? null,
  ];
}

export function rowToStatusCategory(r: Record<string, unknown>): StatusCategory {
  return { id: r.id as string, workspaceId: r.workspace_id as string, name: r.name as string, type: r.type as StatusCategory['type'], color: nullish(r.color), order: r.sort_order as number };
}

export function rowToWorkflowStatus(r: Record<string, unknown>): WorkflowStatus {
  return { id: r.id as string, name: r.name as string, categoryId: r.category_id as string, color: nullish(r.color) };
}

export function rowToWorkflowTransition(r: Record<string, unknown>): WorkflowTransition {
  return {
    id: r.id as string,
    name: r.name as string,
    fromStatusId: r.from_status_id as string,
    toStatusId: r.to_status_id as string,
    requiredFieldIds: parse(r.required_field_ids, undefined),
  };
}

export function assembleWorkflow(workflowRow: Record<string, unknown>, statuses: WorkflowStatus[], transitions: WorkflowTransition[]): Workflow {
  return { id: workflowRow.id as string, name: workflowRow.name as string, initialStatusId: workflowRow.initial_status_id as string, statuses, transitions };
}

export function rowToComponent(r: Record<string, unknown>): Component {
  return { id: r.id as string, projectId: r.project_id as string, name: r.name as string, description: nullish(r.description), leadId: nullish(r.lead_id) };
}

export function rowToVersion(r: Record<string, unknown>): ProjectVersion {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    description: nullish(r.description),
    releaseDate: nullish(r.release_date),
    releasedAt: nullish(r.released_at),
    archivedAt: nullish(r.archived_at),
  };
}

export function rowToIssueType(r: Record<string, unknown>): IssueType {
  return {
    id: r.id as string,
    projectId: nullish(r.project_id) ?? null,
    name: r.name as string,
    icon: nullish(r.icon),
    color: nullish(r.color),
    workflowId: r.workflow_id as string,
    isSubtaskType: bool(r.is_subtask_type),
  };
}

export function rowToLabel(r: Record<string, unknown>): Label {
  return { id: r.id as string, name: r.name as string, color: nullish(r.color) };
}

export function rowToFieldDefinition(r: Record<string, unknown>): FieldDefinition {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    key: r.key as string,
    name: r.name as string,
    type: r.type as FieldDefinition['type'],
    options: parse(r.options, undefined),
    formula: nullish(r.formula),
    scope: parse(r.scope, {}),
    isRequired: bool(r.is_required),
  };
}
export function fieldDefinitionParams(f: FieldDefinition): unknown[] {
  return [f.id, f.workspaceId, f.key, f.name, f.type, j(f.options ?? null), f.formula ?? null, j(f.scope), f.isRequired ? 1 : 0];
}

export function rowToSprint(r: Record<string, unknown>): Sprint {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    goal: nullish(r.goal),
    state: r.state as Sprint['state'],
    startDate: nullish(r.start_date),
    endDate: nullish(r.end_date),
    completedAt: nullish(r.completed_at),
  };
}

export function assembleBoard(r: Record<string, unknown>): Board {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    type: r.type as Board['type'],
    filterId: r.filter_id as string,
    swimlaneBy: nullish(r.swimlane_by) as Board['swimlaneBy'],
    columns: parse(r.columns, []),
  };
}

export function rowToSavedView(r: Record<string, unknown>): SavedView {
  return { id: r.id as string, workspaceId: r.workspace_id as string, name: r.name as string, ownerId: nullish(r.owner_id), isShared: bool(r.is_shared), query: parse(r.query, { all: [] }) };
}

export function rowToAutomationRule(r: Record<string, unknown>): AutomationRule {
  return {
    id: r.id as string,
    projectId: nullish(r.project_id) ?? null,
    name: r.name as string,
    enabled: bool(r.enabled),
    eventFilter: parse(r.event_filter, '*' as const),
    conditions: parse(r.conditions, []),
    actions: parse(r.actions, []),
  };
}
export function automationRuleParams(rule: AutomationRule): unknown[] {
  return [rule.id, rule.projectId, rule.name, rule.enabled ? 1 : 0, j(rule.eventFilter), j(rule.conditions), j(rule.actions)];
}

export function rowToWebhook(r: Record<string, unknown>): WebhookSubscription {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    targetUrl: r.target_url as string,
    secret: r.secret as string,
    eventFilter: parse(r.event_filter, '*' as const),
    enabled: bool(r.enabled),
    createdBy: r.created_by as string,
  };
}
export function webhookParams(h: WebhookSubscription): unknown[] {
  return [h.id, h.workspaceId, h.targetUrl, h.secret, j(h.eventFilter), h.enabled ? 1 : 0, h.createdBy];
}

export function rowToIssue(r: Record<string, unknown>): Issue {
  return {
    id: r.id as string,
    key: r.key as string,
    projectId: r.project_id as string,
    issueTypeId: r.issue_type_id as string,
    statusId: r.status_id as string,
    title: r.title as string,
    description: parse(r.description, undefined),
    priority: r.priority as Issue['priority'],
    reporterId: r.reporter_id as string,
    assigneeIds: parse(r.assignee_ids, []),
    agentAssignments: parse(r.agent_assignments, undefined),
    parentId: nullish(r.parent_id),
    additionalParentIds: parse(r.additional_parent_ids, undefined),
    labelIds: parse(r.label_ids, []),
    componentIds: parse(r.component_ids, []),
    fixVersionIds: parse(r.fix_version_ids, []),
    sprintId: nullish(r.sprint_id),
    storyPoints: r.story_points === null || r.story_points === undefined ? undefined : (r.story_points as number),
    originalEstimateSeconds: r.original_estimate_seconds === null || r.original_estimate_seconds === undefined ? undefined : (r.original_estimate_seconds as number),
    remainingEstimateSeconds: r.remaining_estimate_seconds === null || r.remaining_estimate_seconds === undefined ? undefined : (r.remaining_estimate_seconds as number),
    loggedSeconds: (r.logged_seconds as number) ?? 0,
    fieldValues: parse(r.field_values, []),
    dueDate: nullish(r.due_date),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    resolvedAt: nullish(r.resolved_at),
  };
}

/** Full column list for `issues`, in the order every INSERT/SELECT below uses. */
export const ISSUE_COLUMNS = [
  'id', 'key', 'project_id', 'issue_type_id', 'status_id', 'title', 'description', 'priority', 'reporter_id', 'assignee_ids', 'agent_assignments',
  'parent_id', 'additional_parent_ids', 'label_ids', 'component_ids', 'fix_version_ids', 'sprint_id', 'story_points',
  'original_estimate_seconds', 'remaining_estimate_seconds', 'logged_seconds', 'field_values', 'due_date', 'created_at', 'updated_at', 'resolved_at',
] as const;

export function issueParams(issue: Issue): unknown[] {
  return [
    issue.id,
    issue.key,
    issue.projectId,
    issue.issueTypeId,
    issue.statusId,
    issue.title,
    j(issue.description ?? null),
    issue.priority,
    issue.reporterId,
    j(issue.assigneeIds),
    j(issue.agentAssignments ?? null),
    issue.parentId ?? null,
    j(issue.additionalParentIds ?? null),
    j(issue.labelIds),
    j(issue.componentIds),
    j(issue.fixVersionIds),
    issue.sprintId ?? null,
    issue.storyPoints ?? null,
    issue.originalEstimateSeconds ?? null,
    issue.remainingEstimateSeconds ?? null,
    issue.loggedSeconds,
    j(issue.fieldValues),
    issue.dueDate ?? null,
    issue.createdAt,
    issue.updatedAt,
    issue.resolvedAt ?? null,
  ];
}

export function rowToIssueLink(r: Record<string, unknown>): IssueLink {
  return { id: r.id as string, type: r.type as IssueLink['type'], sourceIssueId: r.source_issue_id as string, targetIssueId: r.target_issue_id as string, createdAt: r.created_at as string, createdBy: r.created_by as string };
}

export function rowToComment(r: Record<string, unknown>): Comment {
  return {
    id: r.id as string,
    issueId: r.issue_id as string,
    authorId: r.author_id as string,
    onBehalfOfUserId: nullish(r.on_behalf_of_user_id),
    body: parse(r.body, { format: 'richtext-v1' as const, content: null, plainText: '' }),
    createdAt: r.created_at as string,
    editedAt: nullish(r.edited_at),
    parentCommentId: nullish(r.parent_comment_id),
  };
}

export function rowToWorklog(r: Record<string, unknown>): Worklog {
  return { id: r.id as string, issueId: r.issue_id as string, authorId: r.author_id as string, timeSpentSeconds: r.time_spent_seconds as number, startedAt: r.started_at as string, note: nullish(r.note) };
}

export function rowToAttachment(r: Record<string, unknown>): Attachment {
  return { id: r.id as string, issueId: r.issue_id as string, uploadedBy: r.uploaded_by as string, fileName: r.file_name as string, mimeType: r.mime_type as string, sizeBytes: r.size_bytes as number, url: r.url as string, createdAt: r.created_at as string };
}

export function rowToGitRepoLink(r: Record<string, unknown>): GitRepoLink {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    provider: r.provider as GitRepoLink['provider'],
    owner: r.owner as string,
    repo: r.repo as string,
    defaultBranch: r.default_branch as string,
    token: r.token as string,
    createdAt: r.created_at as string,
    createdBy: r.created_by as string,
  };
}

/** Enforcement point: every route returning a `GitRepoLink` must go through this — the token never reaches a client response, not even on creation. */
export function toGitRepoLinkPublic(link: GitRepoLink): GitRepoLinkPublic {
  const { token: _token, ...pub } = link;
  return pub;
}

export function rowToBranch(r: Record<string, unknown>): Branch {
  return {
    id: r.id as string,
    issueId: r.issue_id as string,
    gitRepoLinkId: r.git_repo_link_id as string,
    name: r.name as string,
    url: r.url as string,
    createdAt: r.created_at as string,
    createdBy: r.created_by as string,
  };
}
