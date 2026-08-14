import { derived, get, writable } from 'svelte/store';
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
  Workflow,
  Worklog,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '$domain';
import {
  addAttachment as apiAddAttachment,
  addIssueLink as apiAddIssueLink,
  addWorklog as apiAddWorklog,
  assignAgentToIssue as apiAssignAgentToIssue,
  unassignAgentFromIssue as apiUnassignAgentFromIssue,
  completeSprint as apiCompleteSprint,
  createIssue as apiCreateIssue,
  createSprint as apiCreateSprint,
  deleteIssue as apiDeleteIssue,
  createProject as apiCreateProject,
  fetchBootstrap,
  getGitRepoLink,
  linkGitRepo as apiLinkGitRepo,
  unlinkGitRepo as apiUnlinkGitRepo,
  patchIssueStatus,
  postComment,
  updateComment as apiUpdateComment,
  removeAttachment as apiRemoveAttachment,
  removeIssueLink as apiRemoveIssueLink,
  setIssueField as apiSetIssueField,
  startSprint as apiStartSprint,
  updateIssue as apiUpdateIssue,
  updateProject as apiUpdateProject,
  updateWorkspaceMemberRole as apiUpdateWorkspaceMemberRole,
} from '../api';

/** Key used to persist which project was last active, so a reload lands back on it. */
const CURRENT_PROJECT_STORAGE_KEY = 'anvil.currentProjectId';

/** Whether {@link initWorkspace} has completed successfully. */
export const loaded = writable(false);
/** Set if {@link initWorkspace} failed — see the error screen in App.svelte. */
export const loadError = writable<string | null>(null);

/** Which top-level screen is showing: the board, sprint planning, admin settings, or the workspace view. */
export const currentView = writable<'board' | 'backlog' | 'settings' | 'projectSettings' | 'workspace'>('board');

/** Whether the off-canvas sidebar is open on narrow (mobile) viewports — irrelevant above the responsive breakpoint, where the sidebar is always visible. */
export const mobileNavOpen = writable(false);

/**
 * Settings tab to land on next time Settings mounts — set by the TopBar "New…" menu (e.g.
 * "New Label" should open Settings already on the Labels tab). Settings.svelte reads and
 * clears this on mount.
 */
export const settingsJumpTab = writable<string | null>(null);

// Reference data plus mutable issue/comment state, all populated from the API by
// initWorkspace and otherwise treated as read-only by components — every write goes
// through one of the functions below so it's reflected on the server too.
export const workspace = writable<Workspace | null>(null);
export const users = writable<User[]>([]);
export const workspaceMembers = writable<WorkspaceMember[]>([]);
export const agents = writable<Agent[]>([]);
export const agentRuns = writable<AgentRun[]>([]);
export const statusCategories = writable<StatusCategory[]>([]);
export const workflow = writable<Workflow | null>(null);
export const projects = writable<Project[]>([]);
export const currentProjectId = writable<string | null>(null);
/** The currently active project, derived from {@link projects}/{@link currentProjectId} — the replacement for the old singular `project` store now that a workspace can hold many. */
export const currentProject = derived([projects, currentProjectId], ([$projects, $id]) => $projects.find((p) => p.id === $id) ?? null);
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
export const worklogs = writable<Worklog[]>([]);
export const attachments = writable<Attachment[]>([]);
/** The current project's linked git repo, if any — set/cleared from Settings' Git tab, never bootstrapped (scoped, lazily-loaded, and it must never carry the PAT). */
export const gitRepoLink = writable<GitRepoLinkPublic | null>(null);

/** Which issue the drawer is showing, if any. */
export const selectedIssueId = writable<string | null>(null);

/**
 * Loads the workspace from the API and populates every store above. Called once from
 * `App.svelte` on mount. Sets {@link loadError} instead of throwing, so the UI can render
 * a clear "couldn't reach the API" state rather than a blank page.
 */
export async function initWorkspace(): Promise<void> {
  try {
    const persistedProjectId = localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) ?? undefined;
    const data = await fetchBootstrap(persistedProjectId);
    workspace.set(data.workspace);
    users.set(data.users);
    workspaceMembers.set(data.workspaceMembers);
    agents.set(data.agents);
    agentRuns.set(data.agentRuns);
    statusCategories.set(data.statusCategories);
    workflow.set(data.workflow);
    projects.set(data.projects);
    currentProjectId.set(data.currentProjectId);
    localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, data.currentProjectId);
    labels.set(data.labels);
    fieldDefinitions.set(data.fieldDefinitions);
    automationRules.set(data.automationRules);
    webhookSubscriptions.set(data.webhookSubscriptions);
    applyProjectScopedBootstrap(data);
    // Not part of Bootstrap (see gitRepoLink's own doc comment) but still loaded eagerly here,
    // not lazily per-drawer-open, since it's small (never carries the token) and every
    // IssueDrawer needs to know synchronously whether to show its Branch section.
    gitRepoLink.set(await getGitRepoLink(data.currentProjectId).catch(() => null));
    loaded.set(true);
  } catch (err) {
    loadError.set(err instanceof Error ? err.message : 'Failed to load workspace');
  }
}

/** The subset of a bootstrap response that varies per project — shared by {@link initWorkspace} and {@link switchProject}. */
function applyProjectScopedBootstrap(data: Awaited<ReturnType<typeof fetchBootstrap>>): void {
  components.set(data.components);
  versions.set(data.versions);
  issueTypes.set(data.issueTypes);
  sprints.set(data.sprints);
  board.set(data.board);
  savedViews.set(data.savedViews);
  issuesStore.set(data.issues);
  issueLinks.set(data.issueLinks);
  comments.set(data.comments);
  worklogs.set(data.worklogs);
  attachments.set(data.attachments);
  selectedIssueId.set(data.comments[0]?.issueId ?? null);
}

/** Switches the active project: re-fetches its bootstrap slice and applies it, without touching workspace-global stores (users, workflow, labels, agents, etc. — re-setting them would be harmless but pointless). */
export async function switchProject(id: string): Promise<void> {
  const data = await fetchBootstrap(id);
  currentProjectId.set(id);
  localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, id);
  applyProjectScopedBootstrap(data);
  gitRepoLink.set(await getGitRepoLink(id).catch(() => null));
}

/** Creates a new project, adds it to {@link projects}, and switches to it. */
export async function createNewProject(name: string, key: string, leadId?: string): Promise<void> {
  const { project } = await apiCreateProject({ name, key, leadId });
  projects.update((list) => [...list, project]);
  await switchProject(project.id);
}

/** Edits the currently active project (name/lead, or archives via `archivedAt`). */
export async function updateCurrentProject(changes: Partial<Pick<Project, 'name' | 'leadId' | 'archivedAt'>>): Promise<void> {
  const id = get(currentProjectId);
  if (!id) return;
  const updated = await apiUpdateProject(id, changes);
  projects.update((list) => list.map((p) => (p.id === id ? updated : p)));
}

function replaceIssue(issue: Issue): void {
  issuesStore.update((list) => list.map((i) => (i.id === issue.id ? issue : i)));
}

/** Creates a new issue and adds it to {@link issuesStore}. Defaults `projectId` to the active project when the caller doesn't supply one. */
export async function createIssue(fields: Partial<Issue> & { title: string; issueTypeId: string }): Promise<Issue> {
  const { issue } = await apiCreateIssue({ projectId: get(currentProjectId) ?? undefined, ...fields });
  issuesStore.update((list) => [...list, issue]);
  return issue;
}

/** Edits built-in issue fields (not custom field values — see {@link setIssueField}). */
export async function updateIssue(issueId: string, changes: Partial<Issue>): Promise<void> {
  const { issue } = await apiUpdateIssue(issueId, changes);
  replaceIssue(issue);
}

/** Attaches an AI agent to an issue on behalf of one of its current human assignees. */
export async function assignAgent(issueId: string, agentUserId: string, onBehalfOfUserId: string): Promise<void> {
  const { issue } = await apiAssignAgentToIssue(issueId, agentUserId, onBehalfOfUserId);
  replaceIssue(issue);
}

export async function unassignAgent(issueId: string, agentUserId: string): Promise<void> {
  const { issue } = await apiUnassignAgentFromIssue(issueId, agentUserId);
  replaceIssue(issue);
}

/** Links (or replaces) the current project's git repo, from Settings' Git tab. */
export async function linkGitRepo(projectId: string, body: { owner: string; repo: string; defaultBranch?: string; token: string }): Promise<void> {
  gitRepoLink.set(await apiLinkGitRepo(projectId, body));
}

export async function unlinkGitRepo(projectId: string): Promise<void> {
  await apiUnlinkGitRepo(projectId);
  gitRepoLink.set(null);
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
export async function addComment(issueId: string, body: string, parentCommentId?: string): Promise<void> {
  const { comment } = await postComment(issueId, body, parentCommentId);
  comments.update((list) => [...list, comment]);
}

export async function editComment(issueId: string, commentId: string, body: string): Promise<void> {
  const { comment } = await apiUpdateComment(issueId, commentId, body);
  comments.update((list) => list.map((c) => (c.id === commentId ? comment : c)));
}

export async function addIssueLink(issueId: string, type: IssueLinkType, targetIssueId: string): Promise<void> {
  const { link } = await apiAddIssueLink(issueId, type, targetIssueId);
  issueLinks.update((list) => [...list, link]);
}

export async function removeIssueLink(issueId: string, linkId: string): Promise<void> {
  await apiRemoveIssueLink(issueId, linkId);
  issueLinks.update((list) => list.filter((l) => l.id !== linkId));
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
  const id = get(currentProjectId);
  if (!id) return;
  const sprint = await apiCreateSprint(id, name, goal, startDate, endDate);
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
