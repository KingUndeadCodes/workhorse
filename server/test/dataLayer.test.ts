import { describe, expect, it, vi } from 'vitest';
import { ProjectRepository } from '../src/repositories/ProjectRepository';
import { appendEvent, getEventsForIssue, getEventsSince } from '../src/eventLog';
import { createTestEngine, seedHumanUser, seedIssue, seedWorkflow, seedWorkspace } from './helpers';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-encryption-key');

async function projects() {
  const { db } = await import('../src/db/core');
  const repo = new ProjectRepository(db);
  const addProject = (id: string, key: string) =>
    db.insertInto('project').values({ id, workspace_id: 'ws_test', key, name: key, lead_id: null, default_workflow_id: null, color: null, feature_flags: null, next_issue_number: null, created_at: '', archived_at: null }).execute();
  return { db, repo, addProject };
}

describe('issue keys (a counter, not a random suffix)', () => {
  it('numbers issues PROJ-1, PROJ-2, … per project', async () => {
    const { repo, addProject } = await projects();
    await addProject('p1', 'ALPHA');
    await addProject('p2', 'BETA');

    expect([await repo.allocateIssueKey('p1', 'ALPHA'), await repo.allocateIssueKey('p1', 'ALPHA'), await repo.allocateIssueKey('p2', 'BETA'), await repo.allocateIssueKey('p1', 'ALPHA')]).toEqual([
      'ALPHA-1', 'ALPHA-2', 'BETA-1', 'ALPHA-3',
    ]);
  });

  it('hands out distinct, gap-free numbers to concurrent creations', async () => {
    const { repo, addProject } = await projects();
    await addProject('p1', 'ALPHA');

    const keys = await Promise.all(Array.from({ length: 40 }, () => repo.allocateIssueKey('p1', 'ALPHA')));

    expect(new Set(keys).size).toBe(40);
    expect(keys.map((k) => Number(k.split('-')[1])).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('starts after the existing issues and skips any key an older (random-suffix) issue already holds', async () => {
    const { repo, addProject } = await projects();
    const { db } = await import('../src/db/core');
    await addProject('p1', 'ALPHA');
    const issueRepo = createTestEngine(db).issueRepo;
    const reporter = await seedHumanUser(createTestEngine(db).userRepo, 'r@example.com', 'R');
    await seedIssue(issueRepo, { reporterId: reporter.id, projectId: 'p1', key: 'ALPHA-a3f9c2' });
    await seedIssue(issueRepo, { reporterId: reporter.id, projectId: 'p1', key: 'ALPHA-2' }); // a legacy key that happens to look numeric

    expect(await repo.allocateIssueKey('p1', 'ALPHA')).toBe('ALPHA-3'); // 2 existing issues -> start at 3
  });

  it('a key that is already taken is skipped, never reused', async () => {
    const { repo, addProject } = await projects();
    const { db } = await import('../src/db/core');
    await addProject('p1', 'ALPHA');
    const reporter = await seedHumanUser(createTestEngine(db).userRepo, 'r@example.com', 'R');
    await db.updateTable('project').set({ next_issue_number: 1 }).where('id', '=', 'p1').execute();
    await seedIssue(createTestEngine(db).issueRepo, { reporterId: reporter.id, projectId: 'p1', key: 'ALPHA-1' });
    await seedIssue(createTestEngine(db).issueRepo, { reporterId: reporter.id, projectId: 'p1', key: 'ALPHA-2' });

    expect(await repo.allocateIssueKey('p1', 'ALPHA')).toBe('ALPHA-3');
  });
});

describe('issues.key unique index', () => {
  it('rejects a second issue with the same key', async () => {
    const { db } = await projects();
    const { issueRepo, userRepo } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'r@example.com', 'R');
    await seedIssue(issueRepo, { reporterId: reporter.id, key: 'DUP-1' });
    await expect(seedIssue(issueRepo, { reporterId: reporter.id, key: 'DUP-1' })).rejects.toThrow(/unique/i);
  });

  it('on a database that already holds duplicates, skips the index with a warning instead of failing to boot', async () => {
    const { db } = await projects();
    const { stateDb, run } = await import('../src/db/core');
    const { migrateStateDb } = await import('../src/db/schema');
    const { issueRepo, userRepo } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'r@example.com', 'R');
    run(stateDb, `DROP INDEX idx_issues_key`);
    await seedIssue(issueRepo, { reporterId: reporter.id, key: 'DUP-1' });
    await seedIssue(issueRepo, { reporterId: reporter.id, key: 'DUP-1' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => migrateStateDb()).not.toThrow();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate issue key "DUP-1"'));
    warn.mockRestore();
    run(stateDb, `DELETE FROM issues`);
    migrateStateDb(); // once the duplicates are gone, the index comes back
    await seedIssue(issueRepo, { reporterId: reporter.id, key: 'X-1' });
    await expect(seedIssue(issueRepo, { reporterId: reporter.id, key: 'X-1' })).rejects.toThrow(/unique/i);
  });
});

describe('event log lookups', () => {
  const ev = (payload: object, subjectId = 's') => appendEvent({ actor: { kind: 'system' }, subject: { type: 'issue', id: subjectId }, payload: payload as never }, `evt_${Math.random()}`, 'ws_test');

  it('getEventsForIssue returns only that issue\'s events (including its comments), in order, from the indexed column', async () => {
    ev({ type: 'issue.created', issueId: 'i1' });
    ev({ type: 'issue.created', issueId: 'i2' });
    ev({ type: 'comment.created', issueId: 'i1', commentId: 'c1' });
    ev({ type: 'sprint.created', sprintId: 'sp1' }); // no issueId at all
    ev({ type: 'issue.statusChanged', issueId: 'i1' });

    const events = getEventsForIssue('ws_test', 'i1');

    expect(events.map((e) => e.payload.type)).toEqual(['issue.created', 'comment.created', 'issue.statusChanged']);
    expect(events.map((e) => e.sequence)).toEqual([...events.map((e) => e.sequence)].sort((a, b) => a - b));
    expect(getEventsForIssue('ws_test', 'nope')).toEqual([]);
  });

  it('backfills issue_id on rows written before the column existed, and is idempotent', async () => {
    const { eventsDb, run, all } = await import('../src/db/core');
    const { migrateEventsDb } = await import('../src/db/schema');
    run(eventsDb, `INSERT INTO events (id, workspace_id, sequence, occurred_at, actor, subject_type, subject_id, payload, issue_id) VALUES ('old1', 'ws_test', 1, '', '{}', 'issue', 'i9', ?, NULL)`, [JSON.stringify({ type: 'issue.created', issueId: 'i9' })]);
    run(eventsDb, `INSERT INTO events (id, workspace_id, sequence, occurred_at, actor, subject_type, subject_id, payload, issue_id) VALUES ('old2', 'ws_test', 2, '', '{}', 'sprint', 's1', ?, NULL)`, [JSON.stringify({ type: 'sprint.created', sprintId: 's1' })]);

    migrateEventsDb();
    migrateEventsDb();

    expect(all<{ id: string; issue_id: string | null }>(eventsDb, `SELECT id, issue_id FROM events ORDER BY sequence`)).toEqual([
      { id: 'old1', issue_id: 'i9' },
      { id: 'old2', issue_id: null },
    ]);
    expect(getEventsForIssue('ws_test', 'i9')).toHaveLength(1);
  });

  it('uses the (workspace, sequence) and issue indexes', async () => {
    const { eventsDb, all } = await import('../src/db/core');
    const names = all<{ name: string }>(eventsDb, `PRAGMA index_list(events)`).map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['idx_events_workspace_sequence', 'idx_events_issue']));
    const plan = all<{ detail: string }>(eventsDb, `EXPLAIN QUERY PLAN SELECT * FROM events WHERE workspace_id = 'w' AND issue_id = 'i'`).map((r) => r.detail).join(' ');
    expect(plan).toMatch(/USING INDEX idx_events_issue/);
  });

  it('getEventsSince honors a limit and keeps order', () => {
    for (let i = 0; i < 6; i++) ev({ type: 'issue.created', issueId: `i${i}` });
    expect(getEventsSince('ws_test', 0, 4).map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(getEventsSince('ws_test', 4, 4).map((e) => e.sequence)).toEqual([5, 6]);
  });
});

describe('GET /api/events is bounded', () => {
  async function boot() {
    const { db } = await import('../src/db/core');
    const workspaceId = await seedWorkspace(db);
    await seedWorkflow(db);
    const container = await import('../src/container');
    container.initContainer();
    const { signToken } = await import('../src/auth/jwt');
    const { app } = await import('../src/app');
    const user = await container.userRepo.createHuman('m@example.com', 'M', 'hash');
    await container.workspaceRepo.addMember(workspaceId, user.id, 'member', new Date().toISOString());
    const token = await signToken(user);
    return (path: string) => app.request(`/api${path}`, { headers: { authorization: `Bearer ${token}` } });
  }

  it('defaults to a page, clamps the requested limit, and tolerates junk', async () => {
    const get = await boot();
    for (let i = 0; i < 12; i++) appendEvent({ actor: { kind: 'system' }, subject: { type: 'issue', id: 's' }, payload: { type: 'issue.created', issueId: `i${i}` } as never }, `e${i}`, (await (await import('../src/container')).workspaceRepo.getWorkspace()).id);

    const page = (await (await get('/events?limit=5')).json()) as { sequence: number }[];
    expect(page.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
    const next = (await (await get(`/events?since=${page.at(-1)!.sequence}&limit=5`)).json()) as { sequence: number }[];
    expect(next.map((e) => e.sequence)).toEqual([6, 7, 8, 9, 10]);

    expect(((await (await get('/events?limit=0')).json()) as unknown[]).length).toBe(1); // clamped up to 1
    expect(((await (await get('/events?limit=999999')).json()) as unknown[]).length).toBe(12); // clamped down, not unbounded
    expect(((await (await get('/events?limit=abc&since=xyz')).json()) as unknown[]).length).toBe(12);
  });
});

describe('indexed lookups that used to scan whole tables', () => {
  it('UserRepository.hasAgent and findExistingIds answer from an IN query', async () => {
    const { db } = await projects();
    const { userRepo } = createTestEngine(db);
    const human = await seedHumanUser(userRepo, 'h@example.com', 'H');
    await userRepo.createAgentUser('u_agent_1', 'a@agents.local', 'Bot', '2026-01-01');

    expect(await userRepo.hasAgent([])).toBe(false);
    expect(await userRepo.hasAgent([human.id])).toBe(false);
    expect(await userRepo.hasAgent([human.id, 'u_agent_1'])).toBe(true);
    expect(await userRepo.findExistingIds([human.id, 'u_ghost', 'u_agent_1'])).toEqual(new Set([human.id, 'u_agent_1']));
    expect(await userRepo.findExistingIds([])).toEqual(new Set());
  });

  it('AgentRunRepository.listForAgentSince returns only that agent\'s runs inside the window, oldest first', async () => {
    const { db } = await projects();
    const { agentRunRepo } = createTestEngine(db);
    const run = (id: string, agentUserId: string, startedAt: string) =>
      agentRunRepo.upsert({ id, agentUserId, triggeringEventId: 'e', issueId: 'i', status: 'applied', proposedActions: [], startedAt });
    await run('r_old', 'a1', '2026-01-01T00:00:00.000Z');
    await run('r_new2', 'a1', '2026-01-03T00:00:00.000Z');
    await run('r_new1', 'a1', '2026-01-02T00:00:00.000Z');
    await run('r_other', 'a2', '2026-01-03T00:00:00.000Z');

    expect((await agentRunRepo.listForAgentSince('a1', '2026-01-02T00:00:00.000Z')).map((r) => r.id)).toEqual(['r_new1', 'r_new2']);
    expect(await agentRunRepo.listForAgentSince('a1', '2027-01-01T00:00:00.000Z')).toEqual([]);
  });

  it('a run from outside the budget window does not block the agent', async () => {
    const { db } = await projects();
    await seedWorkspace(db);
    await seedWorkflow(db);
    const { engine, userRepo, issueRepo, agentRepo, agentRunRepo, agentRuntimes } = createTestEngine(db);
    const { fixedDecisionRuntime, seedAgent } = await import('./helpers');
    agentRuntimes.register(fixedDecisionRuntime([]));
    const reporter = await seedHumanUser(userRepo, 'r@example.com', 'R');
    const issue = await seedIssue(issueRepo, { reporterId: reporter.id });
    const agent = await seedAgent(userRepo, agentRepo, { budget: { maxRunsPerHour: 1 } });
    await issueRepo.assignAgent(issue.id, agent.userId, new Date().toISOString());
    const startedAt = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    const seedRun = (id: string, msAgo: number) => agentRunRepo.upsert({ id, agentUserId: agent.userId, triggeringEventId: 'e', issueId: issue.id, status: 'applied', proposedActions: [], startedAt: startedAt(msAgo) });

    await seedRun('r_two_hours_ago', 2 * 60 * 60 * 1000);
    expect((await engine.triggerAgentManually(agent.userId, reporter.id, issue.id)).run).toBeDefined(); // the old one is outside the hour
    expect((await engine.triggerAgentManually(agent.userId, reporter.id, issue.id)).run).toBeUndefined(); // …but the run just made is inside it, and the budget is one
  });
});

