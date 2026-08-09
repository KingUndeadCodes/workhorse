import { db } from './db/core';
import {
  assembleBoard,
  assembleWorkflow,
  rowToAgent,
  rowToAgentRun,
  rowToAttachment,
  rowToAutomationRule,
  rowToComment,
  rowToComponent,
  rowToFieldDefinition,
  rowToIssue,
  rowToIssueLink,
  rowToIssueType,
  rowToLabel,
  rowToProject,
  rowToSavedView,
  rowToSprint,
  rowToStatusCategory,
  rowToUser,
  rowToVersion,
  rowToWatcher,
  rowToWebhook,
  rowToWorkflowStatus,
  rowToWorkflowTransition,
  rowToWorklog,
  rowToWorkspace,
  rowToWorkspaceMember,
} from './db/mappers';

/** Read-only queries against `state.db`. Every write path lives elsewhere (projector.ts for
 * operational entities, routes/*.ts directly for catalog/reference CRUD) — this file only reads.
 * Built with Kysely's query-builder methods (data structures) rather than hand-written SQL
 * strings, so table/column typos are caught at compile time against `db/types.ts`. */

export const getWorkspace = async () => rowToWorkspace((await db.selectFrom('workspace').selectAll().executeTakeFirst())!);
export const getProject = async () => rowToProject((await db.selectFrom('project').selectAll().executeTakeFirst())!);
export const listUsers = async () => (await db.selectFrom('users').selectAll().execute()).map(rowToUser);
export const listWorkspaceMembers = async () => (await db.selectFrom('workspace_members').selectAll().execute()).map(rowToWorkspaceMember);
export const getWorkspaceMember = async (userId: string) => {
  const row = await db.selectFrom('workspace_members').selectAll().where('user_id', '=', userId).executeTakeFirst();
  return row ? rowToWorkspaceMember(row) : undefined;
};
export const listAgents = async () => (await db.selectFrom('agents').selectAll().execute()).map(rowToAgent);
export const getAgent = async (userId: string) => {
  const row = await db.selectFrom('agents').selectAll().where('user_id', '=', userId).executeTakeFirst();
  return row ? rowToAgent(row) : undefined;
};
export const listAgentRuns = async () =>
  (await db.selectFrom('agent_runs').selectAll().orderBy('started_at', 'asc').execute()).map(rowToAgentRun);
export const getAgentRun = async (id: string) => {
  const row = await db.selectFrom('agent_runs').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? rowToAgentRun(row) : undefined;
};
export const listStatusCategories = async () =>
  (await db.selectFrom('status_categories').selectAll().orderBy('sort_order', 'asc').execute()).map(rowToStatusCategory);

export async function getWorkflow() {
  const workflowRow = (await db.selectFrom('workflow').selectAll().executeTakeFirst())!;
  const statuses = (
    await db.selectFrom('workflow_statuses').selectAll().where('workflow_id', '=', workflowRow.id).execute()
  ).map(rowToWorkflowStatus);
  const transitions = (
    await db.selectFrom('workflow_transitions').selectAll().where('workflow_id', '=', workflowRow.id).execute()
  ).map(rowToWorkflowTransition);
  return assembleWorkflow(workflowRow, statuses, transitions);
}

export const listComponents = async () => (await db.selectFrom('components').selectAll().execute()).map(rowToComponent);
export const listVersions = async () => (await db.selectFrom('versions').selectAll().execute()).map(rowToVersion);
export const listIssueTypes = async () => (await db.selectFrom('issue_types').selectAll().execute()).map(rowToIssueType);
export const listLabels = async () => (await db.selectFrom('labels').selectAll().execute()).map(rowToLabel);
export const listFieldDefinitions = async () => (await db.selectFrom('field_definitions').selectAll().execute()).map(rowToFieldDefinition);
export const listSprints = async () => (await db.selectFrom('sprints').selectAll().execute()).map(rowToSprint);
export const getSprint = async (id: string) => {
  const row = await db.selectFrom('sprints').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? rowToSprint(row) : undefined;
};
export const getBoard = async () => assembleBoard((await db.selectFrom('board').selectAll().executeTakeFirst())!);
export const listSavedViews = async () => (await db.selectFrom('saved_views').selectAll().execute()).map(rowToSavedView);
export const getSavedView = async (id: string) => {
  const row = await db.selectFrom('saved_views').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? rowToSavedView(row) : undefined;
};
export const listAutomationRules = async () => (await db.selectFrom('automation_rules').selectAll().execute()).map(rowToAutomationRule);
export const listWebhookSubscriptions = async () => (await db.selectFrom('webhook_subscriptions').selectAll().execute()).map(rowToWebhook);

export const listIssues = async () => (await db.selectFrom('issues').selectAll().execute()).map(rowToIssue);
export const getIssue = async (id: string) => {
  const row = await db.selectFrom('issues').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? rowToIssue(row) : undefined;
};
export const listIssueLinks = async () => (await db.selectFrom('issue_links').selectAll().execute()).map(rowToIssueLink);
export const listIssueLinksFor = async (issueId: string) =>
  (
    await db
      .selectFrom('issue_links')
      .selectAll()
      .where((eb) => eb.or([eb('source_issue_id', '=', issueId), eb('target_issue_id', '=', issueId)]))
      .execute()
  ).map(rowToIssueLink);
export const listComments = async () => (await db.selectFrom('comments').selectAll().orderBy('created_at', 'asc').execute()).map(rowToComment);
export const listCommentsFor = async (issueId: string) =>
  (await db.selectFrom('comments').selectAll().where('issue_id', '=', issueId).orderBy('created_at', 'asc').execute()).map(rowToComment);
export const listWatchers = async () => (await db.selectFrom('watchers').selectAll().execute()).map(rowToWatcher);
export const listWatchersFor = async (issueId: string) =>
  (await db.selectFrom('watchers').selectAll().where('issue_id', '=', issueId).execute()).map(rowToWatcher);
export const listWorklogs = async () => (await db.selectFrom('worklogs').selectAll().orderBy('started_at', 'asc').execute()).map(rowToWorklog);
export const listWorklogsFor = async (issueId: string) =>
  (await db.selectFrom('worklogs').selectAll().where('issue_id', '=', issueId).orderBy('started_at', 'asc').execute()).map(rowToWorklog);
export const listAttachments = async () => (await db.selectFrom('attachments').selectAll().execute()).map(rowToAttachment);
export const listAttachmentsFor = async (issueId: string) =>
  (await db.selectFrom('attachments').selectAll().where('issue_id', '=', issueId).execute()).map(rowToAttachment);
