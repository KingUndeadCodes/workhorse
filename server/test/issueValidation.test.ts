import { describe, expect, it, vi } from 'vitest';
import { seedIssue, seedWorkflow, seedWorkspace } from './helpers';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-encryption-key');

async function boot() {
  const { db } = await import('../src/db/core');
  const workspaceId = await seedWorkspace(db);
  await seedWorkflow(db);
  const container = await import('../src/container');
  container.initContainer();
  const { signToken } = await import('../src/auth/jwt');
  const { app } = await import('../src/app');
  await db.insertInto('project').values({ id: 'proj_test', workspace_id: workspaceId, key: 'TEST', name: 'Test', lead_id: null, default_workflow_id: null, color: null, feature_flags: null, next_issue_number: null, created_at: '', archived_at: null }).execute();

  const make = async (role: 'member' | 'guest') => {
    const user = await container.userRepo.createHuman(`${role}@example.com`, role, 'hash');
    await container.workspaceRepo.addMember(workspaceId, user.id, role, new Date().toISOString());
    const token = await signToken(user);
    return (path: string, init: { method?: string; body?: unknown } = {}) =>
      app.request(`/api${path}`, {
        method: init.method ?? 'GET',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
  };
  const call = await make('member');
  const guestCall = await make('guest');
  const owner = (await container.workspaceRepo.listMembers()).find((m) => m.role === 'member')!;
  const issue = await seedIssue(container.issueRepo, { reporterId: owner.userId });
  const label = await container.catalogRepo.createLabel('bug');
  const sprint = await container.planningRepo.createSprint('proj_test', 'Sprint 1');
  const otherProjectSprint = await container.planningRepo.createSprint('some_other_project', 'Elsewhere');
  return { call, guestCall, container, issue, label, sprint, otherProjectSprint, owner };
}

describe('PATCH /api/issues/:id validates what it is given', () => {
  it.each([
    ['an unknown status', { statusId: 'st_nonexistent' }, /statusId/],
    ['a non-string status', { statusId: 42 }, /statusId/],
    ['an invalid priority', { priority: 'urgent!!' }, /priority/],
    ['a non-date due date', { dueDate: 'tomorrow' }, /dueDate/],
    ['an impossible due date', { dueDate: '2026-13-45' }, /dueDate/],
    ['assignees that are not an array', { assigneeIds: 'someone' }, /assigneeIds must be an array/],
    ['an unknown assignee', { assigneeIds: ['u_ghost'] }, /Unknown assignee/],
    ['an unknown label', { labelIds: ['lbl_ghost'] }, /Unknown label/],
    ['labels of the wrong type', { labelIds: [1, 2] }, /labelIds must be an array/],
    ['an unknown component', { componentIds: ['c_ghost'] }, /Unknown component/],
    ['an unknown version', { fixVersionIds: ['v_ghost'] }, /Unknown version/],
    ['an unknown sprint', { sprintId: 'sprint_ghost' }, /sprintId/],
    ['an empty title', { title: '   ' }, /title/],
    ['a numeric title', { title: 123 }, /title/],
    ['a negative estimate', { originalEstimateSeconds: -5 }, /originalEstimateSeconds/],
    ['a string estimate', { remainingEstimateSeconds: 'lots' }, /remainingEstimateSeconds/],
    ['a parent that does not exist', { parentId: 'issue_ghost' }, /parentId/],
  ])('rejects %s with a 400, and changes nothing', async (_label, body, message) => {
    const { call, issue, container } = await boot();
    const res = await call(`/issues/${issue.id}`, { method: 'PATCH', body: { ...body, priority: (body as { priority?: string }).priority ?? 'high' } });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(message);
    expect((await container.issueRepo.get(issue.id))?.priority).toBe('medium'); // not even the valid field in the same body was applied
  });

  it('rejects a sprint that belongs to a different project, and an issue as its own parent', async () => {
    const { call, issue, otherProjectSprint } = await boot();
    expect((await call(`/issues/${issue.id}`, { method: 'PATCH', body: { sprintId: otherProjectSprint.id } })).status).toBe(400);
    expect((await call(`/issues/${issue.id}`, { method: 'PATCH', body: { parentId: issue.id } })).status).toBe(400);
  });

  it('accepts valid references, and null to clear a date or sprint', async () => {
    const { call, issue, label, sprint, owner, container } = await boot();
    const res = await call(`/issues/${issue.id}`, {
      method: 'PATCH',
      body: { statusId: 'st_done', priority: 'high', dueDate: '2026-12-31', labelIds: [label.id], sprintId: sprint.id, assigneeIds: [owner.userId], title: 'Renamed', originalEstimateSeconds: 3600 },
    });
    expect(res.status).toBe(200);
    expect(await container.issueRepo.get(issue.id)).toMatchObject({ statusId: 'st_done', priority: 'high', dueDate: '2026-12-31', labelIds: [label.id], sprintId: sprint.id, title: 'Renamed' });

    const cleared = await call(`/issues/${issue.id}`, { method: 'PATCH', body: { dueDate: null, sprintId: null } });
    expect(cleared.status).toBe(200);
    expect((await container.issueRepo.get(issue.id))?.dueDate).toBeUndefined();
  });
});

describe('POST /api/issues validates the same fields', () => {
  const base = { title: 'New', issueTypeId: 'type_test', projectId: 'proj_test' };

  it('rejects bad references and types', async () => {
    const { call } = await boot();
    for (const bad of [{ priority: 'nope' }, { labelIds: ['lbl_ghost'] }, { assigneeIds: ['u_ghost'] }, { dueDate: 'x' }, { sprintId: 'sprint_ghost' }, { parentId: 'issue_ghost' }]) {
      expect((await call('/issues', { method: 'POST', body: { ...base, ...bad } })).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('creates an issue with numbered keys', async () => {
    const { call } = await boot();
    const first = (await (await call('/issues', { method: 'POST', body: base })).json()) as { issue: { key: string } };
    const second = (await (await call('/issues', { method: 'POST', body: base })).json()) as { issue: { key: string } };
    expect(first.issue.key).toMatch(/^TEST-\d+$/);
    expect(Number(second.issue.key.split('-')[1])).toBe(Number(first.issue.key.split('-')[1]) + 1);
  });
});

describe('custom field edits', () => {
  it('404s for a field that is not defined, instead of logging a change to nothing', async () => {
    const { call, issue } = await boot();
    expect((await call(`/issues/${issue.id}/fields/field_ghost`, { method: 'PATCH', body: { value: 'x' } })).status).toBe(404);
  });
});

describe('guests cannot delete issue structure', () => {
  it.each([
    ['an issue', 'DELETE', (id: string) => `/issues/${id}`],
    ['an issue link', 'DELETE', (id: string) => `/issues/${id}/links/link_1`],
    ['an agent attachment', 'DELETE', (id: string) => `/issues/${id}/agents/u_agent`],
    ['a branch record', 'DELETE', (id: string) => `/issues/${id}/branch`],
  ])('a guest cannot delete %s (403), while a member gets past the role check', async (_label, method, path) => {
    const { call, guestCall, issue } = await boot();
    expect((await guestCall(path(issue.id), { method })).status).toBe(403);
    expect((await call(path(issue.id), { method })).status).not.toBe(403);
  });
});

describe('workflow transitions are enforced on issue edits', () => {
  // Seeded helper workflow: To Do <-> Done. Reshape it to a three-step flow where To Do -> Done is NOT legal.
  async function withReviewStep() {
    const ctx = await boot();
    const { db } = await import('../src/db/core');
    const todo = await db.selectFrom('workflow_statuses').select(['workflow_id', 'category_id']).where('id', '=', 'st_todo').executeTakeFirstOrThrow();
    await db.insertInto('workflow_statuses').values({ id: 'st_review', workflow_id: todo.workflow_id, name: 'In Review', category_id: todo.category_id, color: null }).execute();
    await db.deleteFrom('workflow_transitions').where('id', '=', 'tr_finish').execute();
    await db
      .insertInto('workflow_transitions')
      .values([
        { id: 'tr_to_review', workflow_id: todo.workflow_id, name: 'Start review', from_status_id: 'st_todo', to_status_id: 'st_review', required_field_ids: null },
        { id: 'tr_review_done', workflow_id: todo.workflow_id, name: 'Approve', from_status_id: 'st_review', to_status_id: 'st_done', required_field_ids: null },
      ])
      .execute();
    const status = async () => (await ctx.container.issueRepo.get(ctx.issue.id))?.statusId;
    const move = (statusId: string) => ctx.call(`/issues/${ctx.issue.id}`, { method: 'PATCH', body: { statusId } });
    return { ...ctx, db, status, move, workflowId: todo.workflow_id };
  }

  it('rejects a move the workflow does not offer (To Do -> Done), naming both statuses, and leaves the issue where it was', async () => {
    const { move, status } = await withReviewStep();
    const res = await move('st_done');

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(`The workflow doesn't allow moving from "To Do" to "Done"`);
    expect(await status()).toBe('st_todo');
  });

  it('allows the legal path, step by step', async () => {
    const { move, status } = await withReviewStep();
    expect((await move('st_review')).status).toBe(200);
    expect(await status()).toBe('st_review');
    expect((await move('st_done')).status).toBe(200);
    expect(await status()).toBe('st_done');
  });

  it('a transition is directional: To Do -> In Review does not give In Review -> To Do', async () => {
    const { move, status } = await withReviewStep();
    expect((await move('st_review')).status).toBe(200);

    const back = await move('st_todo');

    expect(back.status).toBe(400);
    expect(((await back.json()) as { error: string }).error).toBe(`The workflow doesn't allow moving from "In Review" to "To Do"`);
    expect(await status()).toBe('st_review');
  });

  it('Done -> To Do works only because tr_reopen exists, and stops working when it is removed', async () => {
    const { move, status, db } = await withReviewStep();
    await move('st_review');
    await move('st_done');
    expect((await move('st_todo')).status).toBe(200); // tr_reopen (st_done -> st_todo) is still in place

    await move('st_review');
    await move('st_done');
    await db.deleteFrom('workflow_transitions').where('id', '=', 'tr_reopen').execute();
    expect((await move('st_todo')).status).toBe(400);
    expect(await status()).toBe('st_done');
  });

  it('a wildcard transition (from "*") applies from every status', async () => {
    const { move, status, db, workflowId } = await withReviewStep();
    await db.deleteFrom('workflow_transitions').where('id', '=', 'tr_reopen').execute();
    await db.insertInto('workflow_transitions').values({ id: 'tr_any_todo', workflow_id: workflowId, name: 'Back to To Do', from_status_id: '*', to_status_id: 'st_todo', required_field_ids: null }).execute();
    await move('st_review');
    expect((await move('st_todo')).status).toBe(200);
    await move('st_review');
    await move('st_done');
    expect((await move('st_todo')).status).toBe(200);
    expect(await status()).toBe('st_todo');
  });

  it('staying in the same status is not a transition, and does not need one', async () => {
    const { move } = await withReviewStep();
    expect((await move('st_todo')).status).toBe(200);
  });

  it('a transition with required fields blocks the move until they are set, naming them', async () => {
    const { move, status, call, issue, db, workflowId, container } = await withReviewStep();
    const field = await container.catalogRepo.createField({ id: 'field_sev', workspaceId: 'ws_test', key: 'severity', name: 'Severity', type: 'text', scope: {}, isRequired: false } as never);
    await db.updateTable('workflow_transitions').set({ required_field_ids: JSON.stringify([field.id]) }).where('id', '=', 'tr_review_done').execute();
    await move('st_review');

    const blocked = await move('st_done');
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { error: string }).error).toBe('Set Severity before moving to "Done"');
    expect(await status()).toBe('st_review');

    expect((await call(`/issues/${issue.id}/fields/${field.id}`, { method: 'PATCH', body: { value: 'high' } })).status).toBe(200);
    expect((await move('st_done')).status).toBe(200);
    void workflowId;
  });

  it('an empty value does not count as set', async () => {
    const { move, call, issue, db, container } = await withReviewStep();
    const field = await container.catalogRepo.createField({ id: 'field_sev', workspaceId: 'ws_test', key: 'severity', name: 'Severity', type: 'text', scope: {}, isRequired: false } as never);
    await db.updateTable('workflow_transitions').set({ required_field_ids: JSON.stringify([field.id]) }).where('id', '=', 'tr_review_done').execute();
    await move('st_review');
    await call(`/issues/${issue.id}/fields/${field.id}`, { method: 'PATCH', body: { value: '' } });
    expect((await move('st_done')).status).toBe(400);
  });

  it('ids chosen by the client are ignored when creating or editing a field definition', async () => {
    const { call } = await boot();
    const created = (await (await call('/fields', { method: 'POST', body: { id: 'field_chosen', workspaceId: 'ws_other', key: 'k', name: 'K', type: 'text', scope: {}, isRequired: false } })).json()) as { id: string; workspaceId: string };
    expect(created.id).not.toBe('field_chosen');
    expect(created.workspaceId).not.toBe('ws_other');

    const patched = (await (await call(`/fields/${created.id}`, { method: 'PATCH', body: { id: 'field_hijack', name: 'Renamed' } })).json()) as { id: string; name: string };
    expect(patched).toMatchObject({ id: created.id, name: 'Renamed' });
  });
});
