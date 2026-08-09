import { eventsDb, run, stateDb } from './core';

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
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY, agent_user_id TEXT, triggering_event_id TEXT, status TEXT, proposed_actions TEXT,
      applied_action_indexes TEXT, rationale TEXT, reviewed_by TEXT, reviewed_at TEXT, started_at TEXT, completed_at TEXT, failure_reason TEXT
    )`,
  );
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
  run(stateDb, `CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id)`);
  run(stateDb, `CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id)`);
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS issue_links (id TEXT PRIMARY KEY, type TEXT, source_issue_id TEXT, target_issue_id TEXT, created_at TEXT, created_by TEXT)`,
  );
  run(stateDb, `CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, issue_id TEXT, author_id TEXT, body TEXT, created_at TEXT, edited_at TEXT)`);
  run(stateDb, `CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments(issue_id)`);
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
