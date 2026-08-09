import { get, writable } from 'svelte/store';
import { currentUser } from './auth';
import type {
  Agent,
  AgentRun,
  Attachment,
  AutomationRule,
  Board,
  Comment,
  Component,
  FieldDefinition,
  FieldValue,
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
  Watcher,
  WebhookSubscription,
  Workflow,
  Worklog,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '$domain';
import {
  addAttachment as apiAddAttachment,
  addIssueLink as apiAddIssueLink,
  addWatcher as apiAddWatcher,
  addWorklog as apiAddWorklog,
  completeSprint as apiCompleteSprint,
  createIssue as apiCreateIssue,
  createSprint as apiCreateSprint,
  deleteIssue as apiDeleteIssue,
  fetchBootstrap,
  patchIssueStatus,
  postComment,
  removeAttachment as apiRemoveAttachment,
  removeIssueLink as apiRemoveIssueLink,
  removeWatcher as apiRemoveWatcher,
  setIssueField as apiSetIssueField,
  startSprint as apiStartSprint,
  updateIssue as apiUpdateIssue,
  updateWorkspaceMemberRole as apiUpdateWorkspaceMemberRole,
} from '../api';

/** Whether {@link initWorkspace} has completed successfully. */
export const loaded = writable(false);
/** Set if {@link initWorkspace} failed — see the error screen in App.svelte. */
export const loadError = writable<string | null>(null);

/** Which top-level screen is showing: the board, sprint planning, admin settings, or the workspace view. */
export const currentView = writable<'board' | 'backlog' | 'settings' | 'workspace'>('board');

/**
 * Settings tab to land on next time Settings mounts — set by the TopBar "New…" menu (e.g.
 * "New Label" should open Settings already on the Labels tab). Settings.svelte reads and
 * clears this on mount.
 */
export const settingsJumpTab = writable<string | null>(null);

// Reference data plus mutable issue/comment/watcher state, all populated from the API by
// initWorkspace and otherwise treated as read-only by components — every write goes
// through one of the functions below so it's reflected on the server too.
export const workspace = writable<Workspace | null>(null);
export const users = writable<User[]>([]);
export const workspaceMembers = writable<WorkspaceMember[]>([]);
export const agents = writable<Agent[]>([]);
export const agentRuns = writable<AgentRun[]>([]);
export const statusCategories = writable<StatusCategory[]>([]);
export const workflow = writable<Workflow | null>(null);
export const project = writable<Project | null>(null);
export const components = writable<Component[]>([]);
export const versions = writable<ProjectVersion[]>([]);
export const issueTypes = writable<IssueType[]>([]);
export const labels = writable<Label[]>([]);
export const fieldDefinitions = writable<FieldDefinition[]>([]);
export const sprints = writable<Sprint[]>([]);
export const board = writable<Board | null>(null);
export const savedViews = writable<SavedView[]>([]);
export const automationRules = writable<AutomationRule[]>([]);
export const webhookSubscriptions = writable<WebhookSubscription[]>([]);
export const issuesStore = writable<Issue[]>([]);
export const issueLinks = writable<IssueLink[]>([]);
export const comments = writable<Comment[]>([]);
export const watchers = writable<Watcher[]>([]);
export const worklogs = writable<Worklog[]>([]);
export const attachments = writable<Attachment[]>([]);

/** Which issue the drawer is showing, if any. */
export const selectedIssueId = writable<string | null>(null);

/**
 * Loads the workspace from the API and populates every store above. Called once from
 * `App.svelte` on mount. Sets {@link loadError} instead of throwing, so the UI can render
 * a clear "couldn't reach the API" state rather than a blank page.
 */
export async function initWorkspace(): Promise<void> {
  try {
    const data = await fetchBootstrap();
    workspace.set(data.workspace);
    users.set(data.users);
    workspaceMembers.set(data.workspaceMembers);
    agents.set(data.agents);
    agentRuns.set(data.agentRuns);
    statusCategories.set(data.statusCategories);
    workflow.set(data.workflow);
    project.set(data.project);
    components.set(data.components);
    versions.set(data.versions);
    issueTypes.set(data.issueTypes);
    labels.set(data.labels);
    fieldDefinitions.set(data.fieldDefinitions);
    sprints.set(data.sprints);
    board.set(data.board);
    savedViews.set(data.savedViews);
    automationRules.set(data.automationRules);
    webhookSubscriptions.set(data.webhookSubscriptions);
    issuesStore.set(data.issues);
    issueLinks.set(data.issueLinks);
    comments.set(data.comments);
    watchers.set(data.watchers);
    worklogs.set(data.worklogs);
    attachments.set(data.attachments);
    selectedIssueId.set(data.comments[0]?.issueId ?? null);
    loaded.set(true);
  } catch (err) {
    loadError.set(err instanceof Error ? err.message : 'Failed to load workspace');
  }
}

function replaceIssue(issue: Issue): void {
  issuesStore.update((list) => list.map((i) => (i.id === issue.id ? issue : i)));
}

/** Creates a new issue and adds it to {@link issuesStore}. */
export async function createIssue(fields: Partial<Issue> & { title: string; issueTypeId: string }): Promise<Issue> {
  const { issue } = await apiCreateIssue(fields);
  issuesStore.update((list) => [...list, issue]);
  return issue;
}

/** Edits built-in issue fields (not custom field values — see {@link setIssueField}). */
export async function updateIssue(issueId: string, changes: Partial<Issue>): Promise<void> {
  const { issue } = await apiUpdateIssue(issueId, changes);
  replaceIssue(issue);
}

/**
 * Moves an issue to a new status via the API, then applies the server's response to
 * {@link issuesStore}. The card only moves once the server confirms the change.
 */
export async function moveIssueToStatus(issueId: string, toStatusId: string): Promise<void> {
  const { issue } = await patchIssueStatus(issueId, toStatusId);
  replaceIssue(issue);
}

/** Sets one custom field's value on an issue. */
export async function setIssueField(issueId: string, fieldId: string, value: FieldValue['value']): Promise<void> {
  const { issue } = await apiSetIssueField(issueId, fieldId, value);
  replaceIssue(issue);
}

/** Deletes an issue everywhere it's cached locally. */
export async function deleteIssue(issueId: string): Promise<void> {
  await apiDeleteIssue(issueId);
  issuesStore.update((list) => list.filter((i) => i.id !== issueId));
  selectedIssueId.update((id) => (id === issueId ? null : id));
}

/** Posts a comment via the API, then appends the server's copy to {@link comments}. */
export async function addComment(issueId: string, body: string): Promise<void> {
  const { comment } = await postComment(issueId, body);
  comments.update((list) => [...list, comment]);
}

export async function addIssueLink(issueId: string, type: IssueLinkType, targetIssueId: string): Promise<void> {
  const { link } = await apiAddIssueLink(issueId, type, targetIssueId);
  issueLinks.update((list) => [...list, link]);
}

export async function removeIssueLink(issueId: string, linkId: string): Promise<void> {
  await apiRemoveIssueLink(issueId, linkId);
  issueLinks.update((list) => list.filter((l) => l.id !== linkId));
}

/** Toggles the current user's watch state on an issue. */
export async function toggleWatching(issueId: string, isWatching: boolean): Promise<void> {
  const userId = get(currentUser)?.id;
  if (isWatching) {
    await apiRemoveWatcher(issueId);
    watchers.update((list) => list.filter((w) => !(w.issueId === issueId && w.userId === userId)));
  } else {
    await apiAddWatcher(issueId);
    watchers.update((list) => [...list, { issueId, userId: userId!, watchingSince: new Date().toISOString() }]);
  }
}

export async function logWork(issueId: string, timeSpentSeconds: number, note?: string): Promise<void> {
  const { worklog, issue } = await apiAddWorklog(issueId, timeSpentSeconds, note);
  worklogs.update((list) => [...list, worklog]);
  replaceIssue(issue);
}

export async function addAttachment(issueId: string, fileName: string, url: string): Promise<void> {
  const { attachment } = await apiAddAttachment(issueId, fileName, url);
  attachments.update((list) => [...list, attachment]);
}

export async function removeAttachment(attachmentId: string): Promise<void> {
  await apiRemoveAttachment(attachmentId);
  attachments.update((list) => list.filter((a) => a.id !== attachmentId));
}

export async function createSprint(name: string, goal?: string, startDate?: string, endDate?: string): Promise<void> {
  const sprint = await apiCreateSprint(name, goal, startDate, endDate);
  sprints.update((list) => [...list, sprint]);
}

export async function startSprint(id: string): Promise<void> {
  const { sprint } = await apiStartSprint(id);
  sprints.update((list) => list.map((s) => (s.id === id ? sprint : s)));
}

export async function completeSprint(id: string): Promise<void> {
  const { sprint } = await apiCompleteSprint(id);
  sprints.update((list) => list.map((s) => (s.id === id ? sprint : s)));
}

export async function updateWorkspaceMemberRole(userId: string, role: WorkspaceRole): Promise<void> {
  const member = await apiUpdateWorkspaceMemberRole(userId, role);
  workspaceMembers.update((list) => list.map((m) => (m.userId === userId ? member : m)));
}
