import type { Board, Project, StatusCategory, Workflow, WorkflowStatus, Workspace } from './domain';
import { DEFAULT_FEATURE_FLAGS, PROJECT_COLORS } from './domain';
import { persistState, run, stateDb } from './db/core';

/**
 * Creates only the structural rows the API assumes exist as fixed singletons — one
 * workspace, one project, a default three-status workflow, the four baseline issue types,
 * and an empty board — nothing else. No sample users, issues, labels, sprints, comments,
 * links, worklogs, attachments, automations, agents, or webhooks: those are content, and
 * this is meant to be an empty database you populate yourself through the UI/API. Runs
 * once, only when `state.db` doesn't exist yet.
 *
 * Issue types are the one gray area — there's no "create an issue type" endpoint yet, and
 * without at least one, no issue could ever be created — so they're treated as structure
 * here alongside the workflow, not content.
 */
export function bootstrapDatabase(): void {
  const workspace: Workspace = { id: 'ws_default', name: 'My Workspace', slug: 'workspace', createdAt: new Date().toISOString() };
  run(stateDb, `INSERT INTO workspace (id, name, slug, created_at) VALUES (?, ?, ?, ?)`, [workspace.id, workspace.name, workspace.slug, workspace.createdAt]);

  const statusCategories: StatusCategory[] = [
    { id: 'cat_todo', workspaceId: workspace.id, name: 'To Do', type: 'todo', order: 0 },
    { id: 'cat_inprogress', workspaceId: workspace.id, name: 'In Progress', type: 'inProgress', order: 1 },
    { id: 'cat_done', workspaceId: workspace.id, name: 'Done', type: 'done', order: 2 },
  ];
  for (const c of statusCategories) run(stateDb, `INSERT INTO status_categories (id, workspace_id, name, type, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`, [c.id, c.workspaceId, c.name, c.type, c.color ?? null, c.order]);

  const workflowId = 'wf_default';
  run(stateDb, `INSERT INTO workflow (id, name, initial_status_id) VALUES (?, ?, ?)`, [workflowId, 'Default Workflow', 'st_todo']);
  const statuses: WorkflowStatus[] = [
    { id: 'st_todo', name: 'To Do', categoryId: 'cat_todo' },
    { id: 'st_inprogress', name: 'In Progress', categoryId: 'cat_inprogress' },
    { id: 'st_done', name: 'Done', categoryId: 'cat_done' },
  ];
  for (const s of statuses) run(stateDb, `INSERT INTO workflow_statuses (id, workflow_id, name, category_id, color) VALUES (?, ?, ?, ?, ?)`, [s.id, workflowId, s.name, s.categoryId, s.color ?? null]);
  const transitions = [
    { id: 'tr_start', name: 'Start Progress', fromStatusId: 'st_todo', toStatusId: 'st_inprogress' },
    { id: 'tr_done', name: 'Mark Done', fromStatusId: 'st_inprogress', toStatusId: 'st_done' },
    { id: 'tr_reopen', name: 'Reopen', fromStatusId: '*', toStatusId: 'st_todo' },
  ];
  for (const t of transitions) run(stateDb, `INSERT INTO workflow_transitions (id, workflow_id, name, from_status_id, to_status_id, required_field_ids) VALUES (?, ?, ?, ?, ?, NULL)`, [t.id, workflowId, t.name, t.fromStatusId, t.toStatusId, null]);

  const project: Project = { id: 'proj_default', workspaceId: workspace.id, key: 'PRJ', name: 'My Project', defaultWorkflowId: workflowId, color: PROJECT_COLORS[0], featureFlags: DEFAULT_FEATURE_FLAGS, createdAt: workspace.createdAt };
  run(stateDb, `INSERT INTO project (id, workspace_id, key, name, lead_id, default_workflow_id, color, feature_flags, created_at, archived_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`, [
    project.id, project.workspaceId, project.key, project.name, project.defaultWorkflowId, project.color, JSON.stringify(project.featureFlags), project.createdAt,
  ]);

  const issueTypes = [
    { id: 'type_story', name: 'Story' },
    { id: 'type_bug', name: 'Bug' },
    { id: 'type_task', name: 'Task' },
    { id: 'type_epic', name: 'Epic' },
  ];
  for (const t of issueTypes) run(stateDb, `INSERT INTO issue_types (id, project_id, name, icon, color, workflow_id, is_subtask_type) VALUES (?, NULL, ?, NULL, NULL, ?, 0)`, [t.id, t.name, workflowId]);

  const board: Board = {
    id: 'board_default', projectId: project.id, name: 'Board', type: 'scrum', filterId: 'view_board_default', swimlaneBy: 'epic',
    columns: [
      { id: 'col_todo', name: 'To Do', statusIds: ['st_todo'] },
      { id: 'col_progress', name: 'In Progress', statusIds: ['st_inprogress'] },
      { id: 'col_done', name: 'Done', statusIds: ['st_done'] },
    ],
  };
  run(stateDb, `INSERT INTO board (id, project_id, name, type, filter_id, swimlane_by, columns) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    board.id, board.projectId, board.name, board.type, board.filterId, board.swimlaneBy ?? null, JSON.stringify(board.columns),
  ]);
  run(stateDb, `INSERT INTO saved_views (id, workspace_id, name, owner_id, is_shared, query) VALUES (?, ?, ?, NULL, 1, ?)`, [
    board.filterId, workspace.id, 'Board default', JSON.stringify({ all: [] }),
  ]);

  persistState();
}
