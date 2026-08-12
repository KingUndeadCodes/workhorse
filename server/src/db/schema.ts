import { all, eventsDb, run, stateDb } from './core';

/** Adds a column to an existing table if it isn't already there — `ALTER TABLE ADD COLUMN`
 * has no `IF NOT EXISTS` form in SQLite, so this checks `pragma table_info` first. Needed
 * for columns added after a table already shipped (the `CREATE TABLE IF NOT EXISTS` above
 * it only helps on a brand-new database). */
function addColumnIfMissing(table: string, column: string, type: string): void {
  const columns = all<{ name: string }>(stateDb, `PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return;
  run(stateDb, `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/**
 * Idempotent `CREATE TABLE IF NOT EXISTS` migrations, run on every boot. Arrays/objects
 * that would otherwise need a join table (label ids on an issue, a rule's actions, an
 * event's actor) are stored as JSON text columns — a deliberate simplification for a
 * prototype, not full third-normal-form, but every column that's actually queried or
 * filtered on (status, assignee, project, dates, ids) is a real typed column.
 */
export function migrateStateDb(): void {
  run(stateDb, `CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY, name TEXT, slug TEXT, created_at TEXT)`);
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, workspace_id TEXT, key TEXT, name TEXT, lead_id TEXT, default_workflow_id TEXT, created_at TEXT, archived_at TEXT)`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, kind TEXT, email TEXT, display_name TEXT, avatar_url TEXT, status TEXT, created_at TEXT)`,
  );
  // Kept out of `users` deliberately: `users` rows feed straight into the bootstrap payload
  // via rowToUser, so a password hash living there is one lazy `SELECT *` away from being
  // shipped to the client. A separate table makes that structurally impossible.
  run(stateDb, `CREATE TABLE IF NOT EXISTS credentials (user_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT)`);
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT, user_id TEXT, role TEXT, joined_at TEXT, PRIMARY KEY (workspace_id, user_id))`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS agents (
      user_id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT, name TEXT, description TEXT, enabled INTEGER,
      event_filter TEXT, allowed_action_types TEXT, approval_policy TEXT, budget TEXT, ignore_self_triggered_events INTEGER, created_at TEXT
    )`,
  );
  addColumnIfMissing('agents', 'model', 'TEXT');
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY, agent_user_id TEXT, triggering_event_id TEXT, status TEXT, proposed_actions TEXT,
      applied_action_indexes TEXT, rationale TEXT, reviewed_by TEXT, reviewed_at TEXT, started_at TEXT, completed_at TEXT, failure_reason TEXT
    )`,
  );
  addColumnIfMissing('agent_runs', 'token_usage', 'INTEGER');
  run(stateDb, `CREATE TABLE IF NOT EXISTS status_categories (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, type TEXT, color TEXT, sort_order INTEGER)`);
  run(stateDb, `CREATE TABLE IF NOT EXISTS workflow (id TEXT PRIMARY KEY, name TEXT, initial_status_id TEXT)`);
  run(stateDb, `CREATE TABLE IF NOT EXISTS workflow_statuses (id TEXT PRIMARY KEY, workflow_id TEXT, name TEXT, category_id TEXT, color TEXT)`);
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS workflow_transitions (id TEXT PRIMARY KEY, workflow_id TEXT, name TEXT, from_status_id TEXT, to_status_id TEXT, required_field_ids TEXT)`,
  );
  run(stateDb, `CREATE TABLE IF NOT EXISTS components (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, description TEXT, lead_id TEXT)`);
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, description TEXT, release_date TEXT, released_at TEXT, archived_at TEXT)`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS issue_types (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, icon TEXT, color TEXT, workflow_id TEXT, is_subtask_type INTEGER)`,
  );
  run(stateDb, `CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, name TEXT, color TEXT)`);
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS field_definitions (
      id TEXT PRIMARY KEY, workspace_id TEXT, key TEXT, name TEXT, type TEXT, options TEXT, formula TEXT, scope TEXT, is_required INTEGER
    )`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS sprints (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, goal TEXT, state TEXT, start_date TEXT, end_date TEXT, completed_at TEXT)`,
  );
  run(stateDb, `CREATE TABLE IF NOT EXISTS board (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, type TEXT, filter_id TEXT, swimlane_by TEXT, columns TEXT)`);
  run(stateDb, `CREATE TABLE IF NOT EXISTS saved_views (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, owner_id TEXT, is_shared INTEGER, query TEXT)`);
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS automation_rules (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, enabled INTEGER, event_filter TEXT, conditions TEXT, actions TEXT)`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS webhook_subscriptions (id TEXT PRIMARY KEY, workspace_id TEXT, target_url TEXT, secret TEXT, event_filter TEXT, enabled INTEGER, created_by TEXT)`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, key TEXT, project_id TEXT, issue_type_id TEXT, status_id TEXT, title TEXT, description TEXT,
      priority TEXT, reporter_id TEXT, assignee_id TEXT, parent_id TEXT, additional_parent_ids TEXT,
      label_ids TEXT, component_ids TEXT, fix_version_ids TEXT, sprint_id TEXT, story_points REAL,
      original_estimate_seconds INTEGER, remaining_estimate_seconds INTEGER, logged_seconds INTEGER,
      field_values TEXT, due_date TEXT, created_at TEXT, updated_at TEXT, resolved_at TEXT
    )`,
  );
  addColumnIfMissing('issues', 'assignee_ids', 'TEXT');
  addColumnIfMissing('issues', 'assigned_by', 'TEXT');
  addColumnIfMissing('issues', 'agent_assignments', 'TEXT');
  run(stateDb, `CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id)`);
  run(stateDb, `CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id)`);
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS issue_links (id TEXT PRIMARY KEY, type TEXT, source_issue_id TEXT, target_issue_id TEXT, created_at TEXT, created_by TEXT)`,
  );
  run(stateDb, `CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, issue_id TEXT, author_id TEXT, body TEXT, created_at TEXT, edited_at TEXT, parent_comment_id TEXT)`);
  run(stateDb, `CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments(issue_id)`);
  addColumnIfMissing('comments', 'parent_comment_id', 'TEXT');
  addColumnIfMissing('comments', 'on_behalf_of_user_id', 'TEXT');
  run(stateDb, `CREATE TABLE IF NOT EXISTS watchers (issue_id TEXT, user_id TEXT, watching_since TEXT, PRIMARY KEY (issue_id, user_id))`);
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS worklogs (id TEXT PRIMARY KEY, issue_id TEXT, author_id TEXT, time_spent_seconds INTEGER, started_at TEXT, note TEXT)`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, issue_id TEXT, uploaded_by TEXT, file_name TEXT, mime_type TEXT, size_bytes INTEGER, url TEXT, created_at TEXT)`,
  );
}

/**
 * One-time catch-up for issues that predate the AI-Agents-are-not-assignees split: any
 * agent-kind id still sitting in `assignee_ids` (from before `agent_assignments` existed) is
 * moved there, using the old `assigned_by` entry for that agent as the human it acted on
 * behalf of — that column already recorded exactly this relationship. An agent with no
 * recoverable `assigned_by` entry is just dropped from `assignee_ids`, since an unattributed
 * agent assignment can't be kept without breaking the "always on behalf of someone" invariant.
 * Raw SQL, not the repository/mapper layer, since `assignedBy` no longer exists on the mapped
 * `Issue` type by design — this is the one place still allowed to read the legacy column.
 */
export function backfillAgentAssignments(): void {
  const agentIds = new Set(all<{ id: string }>(stateDb, `SELECT id FROM users WHERE kind = 'agent'`).map((r) => r.id));
  if (agentIds.size === 0) return;

  const rows = all<{ id: string; assignee_ids: string | null; assigned_by: string | null; agent_assignments: string | null }>(
    stateDb,
    `SELECT id, assignee_ids, assigned_by, agent_assignments FROM issues`,
  );
  for (const row of rows) {
    const assigneeIds: string[] = row.assignee_ids ? JSON.parse(row.assignee_ids) : [];
    const stray = assigneeIds.filter((id) => agentIds.has(id));
    if (stray.length === 0) continue;

    const assignedBy: Record<string, string> = row.assigned_by ? JSON.parse(row.assigned_by) : {};
    const agentAssignments: Record<string, string> = row.agent_assignments ? JSON.parse(row.agent_assignments) : {};
    for (const agentId of stray) {
      const onBehalfOfUserId = assignedBy[agentId];
      if (onBehalfOfUserId) agentAssignments[agentId] = onBehalfOfUserId;
    }
    const humanAssigneeIds = assigneeIds.filter((id) => !agentIds.has(id));
    run(stateDb, `UPDATE issues SET assignee_ids = ?, agent_assignments = ? WHERE id = ?`, [
      JSON.stringify(humanAssigneeIds),
      JSON.stringify(agentAssignments),
      row.id,
    ]);
  }
}

export function migrateEventsDb(): void {
  run(
    eventsDb,
    `CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, workspace_id TEXT, sequence INTEGER, occurred_at TEXT,
      actor TEXT, subject_type TEXT, subject_id TEXT, payload TEXT
    )`,
  );
  run(eventsDb, `CREATE UNIQUE INDEX IF NOT EXISTS idx_events_sequence ON events(sequence)`);
}
