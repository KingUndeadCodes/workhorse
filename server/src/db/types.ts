/**
 * Column-level shape of every table in `state.db`/`events.db`, for Kysely. Column names match
 * `schema.ts` exactly (snake_case, JSON-as-text columns typed `string`). This is the "data
 * structure" side of query building — `db.selectFrom('issues').where('status_id', '=', x)` is
 * checked against this interface at compile time, unlike a hand-written SQL string.
 */
export interface DB {
  workspace: {
    id: string;
    name: string | null;
    slug: string | null;
    created_at: string | null;
  };
  project: {
    id: string;
    workspace_id: string | null;
    key: string | null;
    name: string | null;
    lead_id: string | null;
    default_workflow_id: string | null;
    color: string | null;
    created_at: string | null;
    archived_at: string | null;
  };
  users: {
    id: string;
    kind: string | null;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    status: string | null;
    created_at: string | null;
  };
  credentials: {
    user_id: string;
    password_hash: string;
    created_at: string | null;
  };
  workspace_members: {
    workspace_id: string;
    user_id: string;
    role: string | null;
    joined_at: string | null;
  };
  agents: {
    user_id: string;
    workspace_id: string | null;
    project_id: string | null;
    name: string | null;
    description: string | null;
    enabled: number | null;
    model: string | null;
    event_filter: string | null;
    allowed_action_types: string | null;
    approval_policy: string | null;
    budget: string | null;
    ignore_self_triggered_events: number | null;
    created_at: string | null;
  };
  agent_runs: {
    id: string;
    agent_user_id: string | null;
    triggering_event_id: string | null;
    status: string | null;
    proposed_actions: string | null;
    applied_action_indexes: string | null;
    rationale: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    failure_reason: string | null;
    token_usage: number | null;
    issue_id: string | null;
  };
  status_categories: {
    id: string;
    workspace_id: string | null;
    name: string | null;
    type: string | null;
    color: string | null;
    sort_order: number | null;
  };
  workflow: {
    id: string;
    name: string | null;
    initial_status_id: string | null;
  };
  workflow_statuses: {
    id: string;
    workflow_id: string | null;
    name: string | null;
    category_id: string | null;
    color: string | null;
  };
  workflow_transitions: {
    id: string;
    workflow_id: string | null;
    name: string | null;
    from_status_id: string | null;
    to_status_id: string | null;
    required_field_ids: string | null;
  };
  components: {
    id: string;
    project_id: string | null;
    name: string | null;
    description: string | null;
    lead_id: string | null;
  };
  versions: {
    id: string;
    project_id: string | null;
    name: string | null;
    description: string | null;
    release_date: string | null;
    released_at: string | null;
    archived_at: string | null;
  };
  issue_types: {
    id: string;
    project_id: string | null;
    name: string | null;
    icon: string | null;
    color: string | null;
    workflow_id: string | null;
    is_subtask_type: number | null;
  };
  labels: {
    id: string;
    name: string | null;
    color: string | null;
  };
  field_definitions: {
    id: string;
    workspace_id: string | null;
    key: string | null;
    name: string | null;
    type: string | null;
    options: string | null;
    formula: string | null;
    scope: string | null;
    is_required: number | null;
  };
  sprints: {
    id: string;
    project_id: string | null;
    name: string | null;
    goal: string | null;
    state: string | null;
    start_date: string | null;
    end_date: string | null;
    completed_at: string | null;
  };
  board: {
    id: string;
    project_id: string | null;
    name: string | null;
    type: string | null;
    filter_id: string | null;
    swimlane_by: string | null;
    columns: string | null;
  };
  saved_views: {
    id: string;
    workspace_id: string | null;
    name: string | null;
    owner_id: string | null;
    is_shared: number | null;
    query: string | null;
  };
  automation_rules: {
    id: string;
    project_id: string | null;
    name: string | null;
    enabled: number | null;
    event_filter: string | null;
    conditions: string | null;
    actions: string | null;
  };
  webhook_subscriptions: {
    id: string;
    workspace_id: string | null;
    target_url: string | null;
    secret: string | null;
    event_filter: string | null;
    enabled: number | null;
    created_by: string | null;
  };
  issues: {
    id: string;
    key: string | null;
    project_id: string | null;
    issue_type_id: string | null;
    status_id: string | null;
    title: string | null;
    description: string | null;
    priority: string | null;
    reporter_id: string | null;
    assignee_ids: string | null;
    assigned_by: string | null;
    agent_assignments: string | null;
    parent_id: string | null;
    additional_parent_ids: string | null;
    label_ids: string | null;
    component_ids: string | null;
    fix_version_ids: string | null;
    sprint_id: string | null;
    story_points: number | null;
    original_estimate_seconds: number | null;
    remaining_estimate_seconds: number | null;
    logged_seconds: number | null;
    field_values: string | null;
    due_date: string | null;
    created_at: string | null;
    updated_at: string | null;
    resolved_at: string | null;
  };
  issue_links: {
    id: string;
    type: string | null;
    source_issue_id: string | null;
    target_issue_id: string | null;
    created_at: string | null;
    created_by: string | null;
  };
  comments: {
    id: string;
    issue_id: string | null;
    author_id: string | null;
    on_behalf_of_user_id: string | null;
    body: string | null;
    created_at: string | null;
    edited_at: string | null;
    parent_comment_id: string | null;
  };
  worklogs: {
    id: string;
    issue_id: string | null;
    author_id: string | null;
    time_spent_seconds: number | null;
    started_at: string | null;
    note: string | null;
  };
  attachments: {
    id: string;
    issue_id: string | null;
    uploaded_by: string | null;
    file_name: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    url: string | null;
    created_at: string | null;
  };
  git_repo_links: {
    id: string;
    project_id: string | null;
    provider: string | null;
    owner: string | null;
    repo: string | null;
    default_branch: string | null;
    token: string | null;
    created_at: string | null;
    created_by: string | null;
  };
  branches: {
    id: string;
    issue_id: string | null;
    git_repo_link_id: string | null;
    name: string | null;
    url: string | null;
    created_at: string | null;
    created_by: string | null;
  };
}

export interface EventsDB {
  events: {
    id: string;
    workspace_id: string | null;
    sequence: number | null;
    occurred_at: string | null;
    actor: string | null;
    subject_type: string | null;
    subject_id: string | null;
    payload: string | null;
  };
}
