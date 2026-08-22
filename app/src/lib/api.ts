import { get as getStore } from 'svelte/store';
import type {
  Agent,
  AgentApprovalPolicy,
  AgentBudget,
  AgentRun,
  ActorRef,
  Attachment,
  AutomationAction,
  AutomationRule,
  Board,
  Comment,
  Component,
  Branch,
  EventEnvelope,
  EventType,
  FieldDefinition,
  FieldValue,
  GitRepoLinkPublic,
  Issue,
  IssueLink,
  IssueLinkType,
  IssueType,
  Label,
  Project,
  ProjectVersion,
  SavedView,
  Sprint,
  StatusCategory,
  User,
  WebhookSubscription,
  WebhookSubscriptionPublic,
  Workflow,
  WorkflowStatus,
  WorkflowTransition,
  Worklog,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceStats,
} from '$domain';
import { authToken, clearAuth } from './stores/auth';

/**
 * Mirrors the server's `GET /api/bootstrap` response — defined here from domain types,
 * not imported from the server package, so the frontend depends on the API contract
 * rather than the server's internal storage shape.
 */
export interface Bootstrap {
  workspace: Workspace;
  users: User[];
  workspaceMembers: WorkspaceMember[];
  agents: Agent[];
  agentRuns: AgentRun[];
  statusCategories: StatusCategory[];
  workflow: Workflow;
  projects: Project[];
  currentProjectId: string;
  components: Component[];
  versions: ProjectVersion[];
  issueTypes: IssueType[];
  labels: Label[];
  fieldDefinitions: FieldDefinition[];
  sprints: Sprint[];
  board: Board;
  savedViews: SavedView[];
  automationRules: AutomationRule[];
  webhookSubscriptions: WebhookSubscriptionPublic[];
  issues: Issue[];
  issueLinks: IssueLink[];
  comments: Comment[];
  worklogs: Worklog[];
  attachments: Attachment[];
  events: EventEnvelope[];
  sequence: number;
}

const BASE = '/api';

/** Thrown when a request comes back 401 — the token is missing/expired/invalid. */
export class AuthError extends Error {
  constructor() {
    super('unauthorized');
  }
}

function authHeaders(): Record<string, string> {
  const token = getStore(authToken);
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Parses a fetch {@link Response} as JSON, throwing if the request failed. */
async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    clearAuth();
    throw new AuthError();
  }
  if (!res.ok) {
    // Route handlers send `{ error: "..." }` for expected failures (e.g. "can't delete the
    // Done category") — surface that instead of a bare status code whenever it's present.
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) }).then((r) => json<T>(r));
}
function patch<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${BASE}${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) }).then((r) => json<T>(r));
}
function del<T>(path: string): Promise<T> {
  return fetch(`${BASE}${path}`, { method: 'DELETE', headers: { ...authHeaders() } }).then((r) => json<T>(r));
}
function get<T>(path: string): Promise<T> {
  return fetch(`${BASE}${path}`, { headers: { ...authHeaders() } }).then((r) => json<T>(r));
}

/** Loads the read model for one project (plus every workspace-global list) — called on app start and whenever the active project switches. `projectId` omitted defaults to the server's first project. */
export function fetchBootstrap(projectId?: string): Promise<Bootstrap> {
  return get<Bootstrap>(projectId ? `/bootstrap?projectId=${encodeURIComponent(projectId)}` : '/bootstrap');
}

/**
 * A lightweight entry in an issue's Activity list — enough to render the collapsed row
 * (who, what kind of thing, when) without the full payload. The full details (e.g. a status
 * change's from/to names, a comment's complete body) are only fetched via
 * {@link fetchEventDetail}, and only for the one entry the user actually expands.
 */
export interface ActivityEventSummary {
  id: string;
  occurredAt: string;
  actor: ActorRef;
  type: EventType;
}

/** Fetches the (lightweight) log of every event concerning one issue (oldest first) — powers its Activity tab. */
export function fetchIssueEvents(issueId: string): Promise<{ events: ActivityEventSummary[] }> {
  return get<{ events: ActivityEventSummary[] }>(`/issues/${issueId}/events`);
}

/** Fetches one event's full payload — called only when a user expands that Activity row. */
export function fetchEventDetail(eventId: string): Promise<{ event: EventEnvelope }> {
  return get<{ event: EventEnvelope }>(`/events/${eventId}`);
}

/** Fetches every event with `sequence` greater than the given one. */
export function fetchEventsSince(sequence: number): Promise<EventEnvelope[]> {
  return get<EventEnvelope[]>(`/events?since=${sequence}`);
}

/** Workspace-wide activity/time-spent report for all three windows (24h/1w/30d) in one call. */
export function fetchStats(): Promise<WorkspaceStats> {
  return get<WorkspaceStats>('/stats');
}

// ---- Issues -----------------------------------------------------------------

export function createIssue(fields: Partial<Issue> & { title: string; issueTypeId: string }): Promise<{ issue: Issue; event: EventEnvelope }> {
  return post('/issues', fields);
}

export function updateIssue(issueId: string, changes: Partial<Issue>): Promise<{ issue: Issue }> {
  return patch(`/issues/${issueId}`, changes);
}

export function patchIssueStatus(issueId: string, statusId: string): Promise<{ issue: Issue; event: EventEnvelope | null }> {
  return patch(`/issues/${issueId}`, { statusId });
}

export function setIssueField(issueId: string, fieldId: string, value: FieldValue['value']): Promise<{ issue: Issue; event: EventEnvelope }> {
  return patch(`/issues/${issueId}/fields/${fieldId}`, { value });
}

export function deleteIssue(issueId: string): Promise<{ event: EventEnvelope }> {
  return del(`/issues/${issueId}`);
}

export function postComment(issueId: string, body: string, parentCommentId?: string): Promise<{ comment: Comment; event: EventEnvelope }> {
  return post(`/issues/${issueId}/comments`, { body, parentCommentId });
}
export function updateComment(issueId: string, commentId: string, body: string): Promise<{ comment: Comment; event: EventEnvelope }> {
  return patch(`/issues/${issueId}/comments/${commentId}`, { body });
}
export function deleteComment(issueId: string, commentId: string): Promise<{ event: EventEnvelope }> {
  return del(`/issues/${issueId}/comments/${commentId}`);
}

export function addIssueLink(issueId: string, type: IssueLinkType, targetIssueId: string): Promise<{ link: IssueLink; event: EventEnvelope }> {
  return post(`/issues/${issueId}/links`, { type, targetIssueId });
}

export function removeIssueLink(issueId: string, linkId: string): Promise<{ event: EventEnvelope }> {
  return del(`/issues/${issueId}/links/${linkId}`);
}

/** Attaches an AI agent to an issue — simple membership, like an assignee. */
export function assignAgentToIssue(issueId: string, agentUserId: string): Promise<{ issue: Issue; event: EventEnvelope }> {
  return post(`/issues/${issueId}/agents`, { agentUserId });
}

export function unassignAgentFromIssue(issueId: string, agentUserId: string): Promise<{ issue: Issue; event: EventEnvelope }> {
  return del(`/issues/${issueId}/agents/${agentUserId}`);
}

export function addWorklog(issueId: string, timeSpentSeconds: number, note?: string): Promise<{ worklog: Worklog; issue: Issue; event: EventEnvelope }> {
  return post(`/issues/${issueId}/worklogs`, { timeSpentSeconds, note });
}

export function addAttachment(issueId: string, fileName: string, url: string): Promise<{ attachment: Attachment; event: EventEnvelope }> {
  return post(`/issues/${issueId}/attachments`, { fileName, url });
}

export function removeAttachment(attachmentId: string): Promise<{ ok: true }> {
  return del(`/attachments/${attachmentId}`);
}

// ---- Catalog: labels, components, versions, fields ----------------------------

export function createLabel(name: string, color?: string): Promise<Label> {
  return post('/labels', { name, color });
}
export function deleteLabel(id: string): Promise<{ ok: true }> {
  return del(`/labels/${id}`);
}

export function createComponent(projectId: string, name: string, description?: string): Promise<Component> {
  return post('/components', { projectId, name, description });
}
export function deleteComponent(id: string): Promise<{ ok: true }> {
  return del(`/components/${id}`);
}

export function createVersion(projectId: string, name: string, description?: string, releaseDate?: string): Promise<ProjectVersion> {
  return post('/versions', { projectId, name, description, releaseDate });
}
export function releaseVersion(id: string): Promise<ProjectVersion> {
  return post(`/versions/${id}/release`, {});
}
export function deleteVersion(id: string): Promise<{ ok: true }> {
  return del(`/versions/${id}`);
}

export function createField(field: Omit<FieldDefinition, 'id' | 'workspaceId'>): Promise<FieldDefinition> {
  return post('/fields', field);
}
export function deleteField(id: string): Promise<{ ok: true }> {
  return del(`/fields/${id}`);
}

// ---- Planning: sprints, saved views ---------------------------------------

export function createSprint(projectId: string, name: string, goal?: string, startDate?: string, endDate?: string): Promise<Sprint> {
  return post('/sprints', { projectId, name, goal, startDate, endDate });
}
export function startSprint(id: string): Promise<{ sprint: Sprint; event: EventEnvelope }> {
  return post(`/sprints/${id}/start`, {});
}
export function completeSprint(id: string): Promise<{ sprint: Sprint; event: EventEnvelope }> {
  return post(`/sprints/${id}/complete`, {});
}

// ---- Workflow ---------------------------------------------------------------

export function createStatusCategory(name: string, type: StatusCategory['type'], color?: string): Promise<StatusCategory> {
  return post('/status-categories', { name, type, color });
}
export function deleteStatusCategory(id: string): Promise<{ ok: true }> {
  return del(`/status-categories/${id}`);
}
export function createWorkflowStatus(name: string, categoryId: string, color?: string): Promise<WorkflowStatus> {
  return post('/workflow/statuses', { name, categoryId, color });
}
export function updateWorkflowStatus(id: string, changes: Partial<Pick<WorkflowStatus, 'name' | 'color'>>): Promise<WorkflowStatus> {
  return patch(`/workflow/statuses/${id}`, changes);
}
export function deleteWorkflowStatus(id: string): Promise<{ ok: true }> {
  return del(`/workflow/statuses/${id}`);
}
export function createWorkflowTransition(name: string, fromStatusId: string | '*', toStatusId: string): Promise<WorkflowTransition> {
  return post('/workflow/transitions', { name, fromStatusId, toStatusId });
}
export function deleteWorkflowTransition(id: string): Promise<{ ok: true }> {
  return del(`/workflow/transitions/${id}`);
}

// ---- Automations --------------------------------------------------------------

export function createAutomationRule(rule: Omit<AutomationRule, 'id'>): Promise<AutomationRule> {
  return post('/automations', rule);
}
export function updateAutomationRule(id: string, changes: Partial<AutomationRule>): Promise<AutomationRule> {
  return patch(`/automations/${id}`, changes);
}
export function deleteAutomationRule(id: string): Promise<{ ok: true }> {
  return del(`/automations/${id}`);
}

// ---- Agents ---------------------------------------------------------------

export function createAgent(agent: {
  name: string;
  description?: string;
  runtime?: string;
  model?: string;
  eventFilter: EventType[] | '*';
  allowedActionTypes: AutomationAction['type'][];
  approvalPolicy: AgentApprovalPolicy;
  budget: AgentBudget;
}): Promise<{ agent: Agent; user: User }> {
  return post('/agents', agent);
}
export function updateAgent(userId: string, changes: Partial<Agent>): Promise<Agent> {
  return patch(`/agents/${userId}`, changes);
}
export function triggerAgent(userId: string, issueId?: string): Promise<{ event: EventEnvelope; run?: AgentRun }> {
  return post(`/agents/${userId}/trigger`, { issueId });
}
export function approveAgentRun(runId: string): Promise<{ run: AgentRun }> {
  return post(`/agent-runs/${runId}/approve`, {});
}
export function rejectAgentRun(runId: string): Promise<{ run: AgentRun }> {
  return post(`/agent-runs/${runId}/reject`, {});
}
/** Ids of every AgentRuntime actually registered on the server — lets the UI offer a real choice (or skip asking when there's only one) instead of hardcoding a provider name. */
export function listAgentRuntimes(): Promise<string[]> {
  return get('/agent-runtimes');
}

// ---- Webhooks ---------------------------------------------------------------

export function createWebhook(targetUrl: string, eventFilter: EventType[] | '*'): Promise<WebhookSubscription> {
  return post('/webhooks', { targetUrl, eventFilter });
}
export function updateWebhook(id: string, changes: Partial<Pick<WebhookSubscription, 'targetUrl' | 'eventFilter' | 'enabled'>>): Promise<WebhookSubscriptionPublic> {
  return patch(`/webhooks/${id}`, changes);
}
export function deleteWebhook(id: string): Promise<{ ok: true }> {
  return del(`/webhooks/${id}`);
}

// ---- Projects -----------------------------------------------------------------

export function listProjects(): Promise<Project[]> {
  return get('/projects');
}
export function createProject(body: { name: string; key: string; leadId?: string; color?: string }): Promise<{ project: Project; board: Board }> {
  return post('/projects', body);
}
export function updateProject(id: string, changes: Partial<Pick<Project, 'name' | 'leadId' | 'archivedAt' | 'color' | 'featureFlags'>>): Promise<Project> {
  return patch(`/projects/${id}`, changes);
}

// ---- Git Integration ----------------------------------------------------------

/** Ids of every GitProvider actually registered on the server — lets the UI tell upfront whether linking a repo can work at all. */
export function listGitProviders(): Promise<string[]> {
  return get('/git-providers');
}
export function getGitRepoLink(projectId: string): Promise<GitRepoLinkPublic | null> {
  return get(`/projects/${projectId}/git-repo-link`);
}
export function linkGitRepo(projectId: string, body: { provider: string; owner: string; repo: string; defaultBranch?: string; token: string }): Promise<GitRepoLinkPublic> {
  return post(`/projects/${projectId}/git-repo-link`, body);
}
export function unlinkGitRepo(projectId: string): Promise<{ ok: true }> {
  return del(`/projects/${projectId}/git-repo-link`);
}
export function getBranch(issueId: string): Promise<{ branch: Branch | null }> {
  return get(`/issues/${issueId}/branch`);
}
export function createBranch(issueId: string, name?: string): Promise<{ branch: Branch; event: EventEnvelope }> {
  return post(`/issues/${issueId}/branch`, { name });
}
export function deleteBranch(issueId: string): Promise<{ ok: true }> {
  return del(`/issues/${issueId}/branch`);
}

// ---- Workspace membership ---------------------------------------------------

export function listWorkspaceMembers(): Promise<WorkspaceMember[]> {
  return get('/workspace-members');
}
export function updateWorkspaceMemberRole(userId: string, role: WorkspaceRole): Promise<WorkspaceMember> {
  return patch(`/workspace-members/${userId}`, { role });
}

// ---- Account ------------------------------------------------------------------

/** Updates the caller's own profile. `avatarUrl` is a data: URL, or `null` to remove the picture. */
export function updateProfile(changes: { displayName?: string; email?: string; avatarUrl?: string | null }): Promise<{ user: User }> {
  return patch('/auth/me', changes);
}
