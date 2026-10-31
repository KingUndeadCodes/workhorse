import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { createTestEngine, seedAutomationRule, seedHumanUser, seedIssue, seedWorkflow, seedWorkspace } from './helpers';

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

  const people = {} as Record<'owner' | 'member', { id: string; call: (path: string, init?: { method?: string; body?: unknown }) => Response | Promise<Response> }>;
  for (const role of ['owner', 'member'] as const) {
    const user = await container.userRepo.createHuman(`${role}@example.com`, role, await hashPassword('correct horse'));
    await container.workspaceRepo.addMember(workspaceId, user.id, role, new Date().toISOString());
    const token = await signToken(user);
    people[role] = {
      id: user.id,
      call: (path, init = {}) =>
        app.request(`/api${path}`, {
          method: init.method ?? 'GET',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
    };
  }
  return { container, people };
}

describe('workspace feature flags', () => {
  it('defaults every module to on, including for workspaces saved before the flags existed', async () => {
    const { container } = await boot();
    expect((await container.workspaceRepo.getWorkspace()).featureFlags).toEqual({ agents: true, automations: true, webhooks: true, insights: true, git: true });
  });

  it('lets only an owner/admin change them, and validates the body', async () => {
    const { people, container } = await boot();
    expect((await people.member.call('/workspace/features', { method: 'PATCH', body: { agents: false } })).status).toBe(403);
    expect((await people.owner.call('/workspace/features', { method: 'PATCH', body: { bogus: false } })).status).toBe(400);
    expect((await people.owner.call('/workspace/features', { method: 'PATCH', body: { agents: 'no' } })).status).toBe(400);
    expect((await container.workspaceRepo.getWorkspace()).featureFlags.agents).toBe(true);

    const res = await people.owner.call('/workspace/features', { method: 'PATCH', body: { agents: false } });
    expect(res.status).toBe(200);
    expect((await res.json()).featureFlags).toMatchObject({ agents: false, automations: true });
    expect((await container.workspaceRepo.getWorkspace()).featureFlags.agents).toBe(false);
  });

  it('a partial update leaves the other flags alone, and turning a module back on restores access', async () => {
    const { people } = await boot();
    await people.owner.call('/workspace/features', { method: 'PATCH', body: { agents: false } });
    await people.owner.call('/workspace/features', { method: 'PATCH', body: { webhooks: false } });
    const off = await people.owner.call('/agents', { method: 'POST', body: {} });
    expect(off.status).toBe(403);

    await people.owner.call('/workspace/features', { method: 'PATCH', body: { agents: true } });
    expect((await people.owner.call('/agents', { method: 'POST', body: {} })).status).toBe(400); // reaches the real handler (name required)
  });

  it('rejects writes to a switched-off module but still lets its data be read', async () => {
    const { people } = await boot();
    await people.owner.call('/workspace/features', { method: 'PATCH', body: { agents: false, automations: false, webhooks: false } });

    expect((await people.owner.call('/agents')).status).toBe(200);
    expect((await people.owner.call('/automations')).status).toBe(200);
    expect((await people.owner.call('/webhooks')).status).toBe(200);
    for (const [path, body] of [['/agents', {}], ['/automations', {}], ['/webhooks', {}], ['/agent-runs/x/approve', {}]] as const) {
      const res = await people.owner.call(path, { method: 'POST', body });
      expect(res.status, path).toBe(403);
      expect((await res.json()).error).toMatch(/turned off/);
    }
  });

  it('rejects every request to switched-off insights and git', async () => {
    const { people } = await boot();
    expect((await people.owner.call('/stats')).status).toBe(200);
    await people.owner.call('/workspace/features', { method: 'PATCH', body: { insights: false, git: false } });
    for (const path of ['/stats', '/git-connections', '/git-providers']) {
      expect((await people.owner.call(path)).status, path).toBe(403);
    }
  });

  it('stops agent attach on issues while agents are off', async () => {
    const { people, container } = await boot();
    const issue = await seedIssue(container.issueRepo, { reporterId: people.owner.id });
    await people.owner.call('/workspace/features', { method: 'PATCH', body: { agents: false } });
    expect((await people.owner.call(`/issues/${issue.id}/agents`, { method: 'POST', body: { agentUserId: 'x' } })).status).toBe(403);
  });
});

describe('EventEngine respects switched-off modules', () => {
  async function setup() {
    const { db } = await import('../src/db/core');
    await seedWorkspace(db);
    await seedWorkflow(db);
    const { engine, workspaceRepo, userRepo, issueRepo, automationRepo } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'reporter@example.com', 'Reporter');
    const issue = await seedIssue(issueRepo, { reporterId: reporter.id, statusId: 'st_todo' });
    await seedAutomationRule(automationRepo, { eventFilter: ['issue.priorityChanged'], actions: [{ type: 'transitionStatus', toStatusId: 'st_done' }] });
    const fire = () =>
      engine.emitEvent({
        actor: { kind: 'user', userId: reporter.id },
        subject: { type: 'issue', id: issue.id },
        payload: { type: 'issue.priorityChanged', issueId: issue.id, fromPriority: 'medium', toPriority: 'high' },
      });
    return { workspaceRepo, issueRepo, issue, fire };
  }

  it('does not run automation rules while automations are off, and resumes when they are back on', async () => {
    const { workspaceRepo, issueRepo, issue, fire } = await setup();
    const flags = (await workspaceRepo.getWorkspace()).featureFlags;
    await workspaceRepo.setFeatureFlags({ ...flags, automations: false });
    await fire();
    expect((await issueRepo.get(issue.id))?.statusId).toBe('st_todo');

    await workspaceRepo.setFeatureFlags({ ...flags, automations: true });
    await fire();
    expect((await issueRepo.get(issue.id))?.statusId).toBe('st_done');
  });
});
