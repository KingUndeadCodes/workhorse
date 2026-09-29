import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WorkspaceRepository } from '../src/repositories/WorkspaceRepository';
import { seedWorkspace } from './helpers';

describe('WorkspaceRepository', () => {
  async function setup() {
    const { db } = await import('../src/db/core');
    const workspaceId = await seedWorkspace(db);
    return { repo: new WorkspaceRepository(db), workspaceId };
  }

  it('removeMember deletes the membership row', async () => {
    const { repo, workspaceId } = await setup();
    await repo.addMember(workspaceId, 'u_1', 'member', new Date().toISOString());
    expect(await repo.getMember('u_1')).toBeDefined();

    await repo.removeMember(workspaceId, 'u_1');

    expect(await repo.getMember('u_1')).toBeUndefined();
  });

  it('createInvite/listInvites/getInviteByEmail round-trip', async () => {
    const { repo, workspaceId } = await setup();
    const invite = await repo.createInvite({
      id: `invite_${randomUUID()}`,
      workspaceId,
      email: 'new@example.com',
      role: 'admin',
      invitedBy: 'u_owner',
      createdAt: new Date().toISOString(),
    });

    expect(await repo.listInvites(workspaceId)).toEqual([invite]);
    expect(await repo.getInviteByEmail('new@example.com')).toEqual(invite);
    expect(await repo.getInviteByEmail('nobody@example.com')).toBeUndefined();
  });

  it('deleteInviteByEmail consumes a pending invite', async () => {
    const { repo, workspaceId } = await setup();
    await repo.createInvite({
      id: `invite_${randomUUID()}`,
      workspaceId,
      email: 'once@example.com',
      role: 'member',
      invitedBy: 'u_owner',
      createdAt: new Date().toISOString(),
    });

    await repo.deleteInviteByEmail('once@example.com');

    expect(await repo.getInviteByEmail('once@example.com')).toBeUndefined();
  });

  it('deleteInvite removes by id, leaving other invites untouched', async () => {
    const { repo, workspaceId } = await setup();
    const keep = await repo.createInvite({
      id: `invite_${randomUUID()}`,
      workspaceId,
      email: 'keep@example.com',
      role: 'member',
      invitedBy: 'u_owner',
      createdAt: new Date().toISOString(),
    });
    const revoke = await repo.createInvite({
      id: `invite_${randomUUID()}`,
      workspaceId,
      email: 'revoke@example.com',
      role: 'member',
      invitedBy: 'u_owner',
      createdAt: new Date().toISOString(),
    });

    await repo.deleteInvite(revoke.id);

    const remaining = await repo.listInvites(workspaceId);
    expect(remaining).toEqual([keep]);
  });
});
