import { all, eventsDb, get, run, stateDb } from './core';
import { PROJECT_COLORS } from '../domain';

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
  // Issue keys are `${project.key}-${suffix}` — two projects sharing a prefix would make keys
  // ambiguous. Safe/idempotent against the single pre-existing seeded project.
  run(stateDb, `CREATE UNIQUE INDEX IF NOT EXISTS idx_project_key ON project(key)`);
  addColumnIfMissing('project', 'color', 'TEXT');
  addColumnIfMissing('project', 'feature_flags', 'TEXT');
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, kind TEXT, email TEXT, display_name TEXT, avatar_url TEXT, status TEXT, created_at TEXT)`,
  );
  // The real enforcement for email uniqueness — routes/auth.ts's findByEmail-then-create check
  // is only a fast path, not a lock, the same relationship idx_branches_issue has to its route's
  // own check-then-act read (see that index's comment below).
  run(stateDb, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
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
  addColumnIfMissing('agents', 'runtime', 'TEXT');
  addColumnIfMissing('agents', 'context_scope', 'TEXT');
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY, agent_user_id TEXT, triggering_event_id TEXT, status TEXT, proposed_actions TEXT,
      applied_action_indexes TEXT, rationale TEXT, reviewed_by TEXT, reviewed_at TEXT, started_at TEXT, completed_at TEXT, failure_reason TEXT
    )`,
  );
  addColumnIfMissing('agent_runs', 'token_usage', 'INTEGER');
  addColumnIfMissing('agent_runs', 'issue_id', 'TEXT');
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
      priority TEXT, reporter_id TEXT, parent_id TEXT, additional_parent_ids TEXT,
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
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS worklogs (id TEXT PRIMARY KEY, issue_id TEXT, author_id TEXT, time_spent_seconds INTEGER, started_at TEXT, note TEXT)`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, issue_id TEXT, uploaded_by TEXT, file_name TEXT, mime_type TEXT, size_bytes INTEGER, url TEXT, created_at TEXT)`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS git_repo_links (
      id TEXT PRIMARY KEY, project_id TEXT, provider TEXT, owner TEXT, repo TEXT, default_branch TEXT, token TEXT, created_at TEXT, created_by TEXT
    )`,
  );
  run(
    stateDb,
    `CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, issue_id TEXT, git_repo_link_id TEXT, name TEXT, url TEXT, created_at TEXT, created_by TEXT)`,
  );
  // Enforces "at most one active branch per issue" at the DB level — without this, two
  // concurrent POST /issues/:id/branch requests could both pass the route's check-then-act
  // read and each insert a row, leaving `getBranchFor`'s unordered `executeTakeFirst()` to
  // arbitrarily pick between them.
  run(stateDb, `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_issue ON branches(issue_id)`);
}

/**
 * One-time catch-up for issues that predate the AI-Agents-are-not-assignees split: any
 * agent-kind id still sitting in `assignee_ids` (from before `agent_assignments` existed) is
 * moved there instead — simple membership, same as every other issue's `agent_assignments`
 * (see domain/issue.ts; this list no longer ties an agent to a specific human it acted "on
 * behalf of"). Raw SQL, not the repository/mapper layer, since this reads `assignee_ids`
 * directly rather than going through the mapped `Issue` type.
 */
export function backfillAgentAssignments(): void {
  const agentIds = new Set(all<{ id: string }>(stateDb, `SELECT id FROM users WHERE kind = 'agent'`).map((r) => r.id));
  if (agentIds.size === 0) return;

  const rows = all<{ id: string; assignee_ids: string | null; agent_assignments: string | null }>(
    stateDb,
    `SELECT id, assignee_ids, agent_assignments FROM issues`,
  );
  for (const row of rows) {
    const assigneeIds: string[] = row.assignee_ids ? JSON.parse(row.assignee_ids) : [];
    const stray = assigneeIds.filter((id) => agentIds.has(id));
    if (stray.length === 0) continue;

    const agentAssignments: string[] = row.agent_assignments ? JSON.parse(row.agent_assignments) : [];
    const mergedAgentAssignments = [...new Set([...agentAssignments, ...stray])];
    const humanAssigneeIds = assigneeIds.filter((id) => !agentIds.has(id));
    run(stateDb, `UPDATE issues SET assignee_ids = ?, agent_assignments = ? WHERE id = ?`, [
      JSON.stringify(humanAssigneeIds),
      JSON.stringify(mergedAgentAssignments),
      row.id,
    ]);
  }
}

/**
 * One-time catch-up for issues that predate the single-`assignee_id` -> multi-`assignee_ids`
 * split: copies the old column's value into the new JSON array column so upgrading doesn't
 * silently unassign every already-assigned issue. `assignee_id` only still exists on databases
 * created before this split (SQLite's `ALTER TABLE ADD COLUMN` never removes it), so this is a
 * no-op on a fresh database.
 */
export function backfillIssueAssignees(): void {
  const columns = all<{ name: string }>(stateDb, `PRAGMA table_info(issues)`);
  if (!columns.some((c) => c.name === 'assignee_id')) return;

  const rows = all<{ id: string; assignee_id: string | null; assignee_ids: string | null }>(
    stateDb,
    `SELECT id, assignee_id, assignee_ids FROM issues WHERE assignee_id IS NOT NULL`,
  );
  for (const row of rows) {
    const existing: string[] = row.assignee_ids ? JSON.parse(row.assignee_ids) : [];
    if (existing.length > 0) continue;
    run(stateDb, `UPDATE issues SET assignee_ids = ? WHERE id = ?`, [JSON.stringify([row.assignee_id]), row.id]);
  }
}

/**
 * One-time catch-up for agent runs that predate the `agent_runs.issue_id` column: derives it
 * from the triggering event's subject, mirroring the resolution `resolveAgentRun` used to do
 * directly before this column existed — without this, approving a pre-existing run fails with
 * "Could not resolve the issue this run was about."
 */
export function backfillAgentRunIssueIds(): void {
  const rows = all<{ id: string; triggering_event_id: string }>(
    stateDb,
    `SELECT id, triggering_event_id FROM agent_runs WHERE issue_id IS NULL`,
  );
  for (const row of rows) {
    const event = get<{ subject_type: string; subject_id: string }>(
      eventsDb,
      `SELECT subject_type, subject_id FROM events WHERE id = ?`,
      [row.triggering_event_id],
    );
    if (event?.subject_type === 'issue') {
      run(stateDb, `UPDATE agent_runs SET issue_id = ? WHERE id = ?`, [event.subject_id, row.id]);
    }
  }
}

/** One-time catch-up for projects that predate the `color` column — assigns each a color from {@link PROJECT_COLORS}, cycling in `created_at` order so the assignment is stable across repeated boots. */
export function backfillProjectColors(): void {
  const rows = all<{ id: string; color: string | null }>(stateDb, `SELECT id, color FROM project ORDER BY created_at ASC`);
  let i = 0;
  for (const row of rows) {
    if (row.color) {
      i++;
      continue;
    }
    run(stateDb, `UPDATE project SET color = ? WHERE id = ?`, [PROJECT_COLORS[i % PROJECT_COLORS.length], row.id]);
    i++;
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
