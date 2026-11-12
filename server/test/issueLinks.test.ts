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

  const user = await container.userRepo.createHuman('member@example.com', 'member', 'hash');
  await container.workspaceRepo.addMember(workspaceId, user.id, 'member', new Date().toISOString());
  const token = await signToken(user);
  const link = (fromId: string, type: string, toId: string) =>
    app.request(`/api/issues/${fromId}/links`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type, targetIssueId: toId }),
    });
  const a = await seedIssue(container.issueRepo, { reporterId: user.id });
  const b = await seedIssue(container.issueRepo, { reporterId: user.id });
  return { link, a, b, container };
}

describe('POST /api/issues/:id/links', () => {
  it('creates a link, and refuses the identical one again with a 409 instead of a second row', async () => {
    const { link, a, b, container } = await boot();
    expect((await link(a.id, 'blocks', b.id)).status).toBe(201);
    const again = await link(a.id, 'blocks', b.id);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/already linked/);
    expect(await container.issueRepo.listLinksFor(a.id)).toHaveLength(1);
  });

  it('treats the reverse of a directional link as a different fact (A blocks B, B blocks A)', async () => {
    const { link, a, b } = await boot();
    expect((await link(a.id, 'blocks', b.id)).status).toBe(201);
    expect((await link(b.id, 'blocks', a.id)).status).toBe(201);
  });

  it('allows the same pair with a different type', async () => {
    const { link, a, b } = await boot();
    expect((await link(a.id, 'blocks', b.id)).status).toBe(201);
    expect((await link(a.id, 'relatesTo', b.id)).status).toBe(201);
  });

  it('treats "relates to" as having no direction, so the reverse pairing is a duplicate', async () => {
    const { link, a, b } = await boot();
    expect((await link(a.id, 'relatesTo', b.id)).status).toBe(201);
    expect((await link(b.id, 'relatesTo', a.id)).status).toBe(409);
  });

  it('rejects an unknown link type and a self-link', async () => {
    const { link, a, b } = await boot();
    expect((await link(a.id, 'nonsense', b.id)).status).toBe(400);
    expect((await link(a.id, 'blocks', a.id)).status).toBe(400);
  });
});
