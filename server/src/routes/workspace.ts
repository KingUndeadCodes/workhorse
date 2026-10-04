import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { WorkspaceRole } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { userRepo, workspaceRepo } from '../container';
import { disconnectUser } from '../ws';

/**
 * Workspace membership — who's in this workspace, what role they hold, and (via
 * `workspace_invites`, see domain/user.ts's `WorkspaceInvite`) who's pre-approved to join with
 * a specific role once they sign up. Invites are an allowlist only — this app never sends an
 * email; an admin shares the signup link out of band.
 */
export const workspaceRouter = new Hono<{ Variables: AuthVariables }>();

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];

// Serializes the "read current owners, then write a role change" below — same chained-promise
// approach as IssueRepository.withIssueLock/EventEngine.withAgentLock — so two concurrent
// demotions of different owners can't both pass the "at least one owner left" check before
// either write commits. Single workspace, so one lock (no per-id keying) is enough.
let memberRoleLock: Promise<unknown> = Promise.resolve();
function withMemberRoleLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = memberRoleLock.then(fn, fn);
  memberRoleLock = next.catch(() => undefined);
  return next;
}

/** The caller's own membership, or `undefined` if they're not an owner/admin — the shared gate every route below needs. */
async function requireAdmin(c: { get(key: 'user'): { id: string } }) {
  const caller = await workspaceRepo.getMember(c.get('user').id);
  return caller && (caller.role === 'owner' || caller.role === 'admin') ? caller : undefined;
}

workspaceRouter.get('/workspace-members', async (c) => c.json(await workspaceRepo.listMembers()));

/** PATCH /api/workspace-members/:userId — change a member's role. Only owners/admins may do this. */
workspaceRouter.patch('/workspace-members/:userId', async (c) => {
  const targetId = c.req.param('userId');
  const caller = await requireAdmin(c);
  if (!caller) return c.json({ error: 'Only workspace owners/admins can change roles' }, 403);
  const target = await workspaceRepo.getMember(targetId);
  if (!target) return c.json({ error: 'Not a member of this workspace' }, 404);

  const body = await c.req.json<{ role: WorkspaceRole }>();
  if (!ROLES.includes(body.role)) return c.json({ error: 'Invalid role' }, 400);

  // Only an owner may grant ownership — an admin promoting themselves (or anyone else) to
  // owner would be a self-escalation with no check above it.
  if (body.role === 'owner' && caller.role !== 'owner') {
    return c.json({ error: 'Only an owner can grant ownership' }, 403);
  }
  return withMemberRoleLock(async () => {
    // Never let the workspace end up with zero owners — there'd be no path back, since signup
    // only grants 'owner' when the workspace has no members yet.
    if (target.role === 'owner' && body.role !== 'owner') {
      const owners = (await workspaceRepo.listMembers()).filter((m) => m.role === 'owner');
      if (owners.length <= 1) return c.json({ error: "Can't remove the workspace's last owner" }, 400);
    }

    const workspace = await workspaceRepo.getWorkspace();
    return c.json(await workspaceRepo.updateMemberRole(workspace.id, targetId, body.role));
  });
});

/**
 * DELETE /api/workspace-members/:userId — remove a member entirely. Only owners/admins may do
 * this; never against your own membership (there'd be no path back into a single-workspace app
 * you just removed yourself from), and never leaving the workspace with zero owners.
 */
workspaceRouter.delete('/workspace-members/:userId', async (c) => {
  const targetId = c.req.param('userId');
  const caller = await requireAdmin(c);
  if (!caller) return c.json({ error: 'Only workspace owners/admins can remove members' }, 403);
  if (targetId === c.get('user').id) return c.json({ error: "Can't remove yourself" }, 400);
  const target = await workspaceRepo.getMember(targetId);
  if (!target) return c.json({ error: 'Not a member of this workspace' }, 404);

  return withMemberRoleLock(async () => {
    if (target.role === 'owner') {
      const owners = (await workspaceRepo.listMembers()).filter((m) => m.role === 'owner');
      if (owners.length <= 1) return c.json({ error: "Can't remove the workspace's last owner" }, 400);
    }
    const workspace = await workspaceRepo.getWorkspace();
    await workspaceRepo.removeMember(workspace.id, targetId);
    disconnectUser(targetId);
    return c.json({ ok: true });
  });
});

/** GET /api/workspace-invites — pending signup pre-approvals. Only owners/admins may see the list. */
workspaceRouter.get('/workspace-invites', async (c) => {
  const caller = await requireAdmin(c);
  if (!caller) return c.json({ error: 'Only workspace owners/admins can view invites' }, 403);
  const workspace = await workspaceRepo.getWorkspace();
  return c.json(await workspaceRepo.listInvites(workspace.id));
});

/**
 * POST /api/workspace-invites — pre-approve an email for a given role. No email is sent; share
 * the signup link with the invitee yourself. Body: `{ email, role }`.
 */
workspaceRouter.post('/workspace-invites', async (c) => {
  const caller = await requireAdmin(c);
  if (!caller) return c.json({ error: 'Only workspace owners/admins can invite' }, 403);

  const body = await c.req.json<{ email?: string; role?: WorkspaceRole }>();
  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return c.json({ error: 'a valid email is required' }, 400);
  if (!body.role || !ROLES.includes(body.role)) return c.json({ error: 'Invalid role' }, 400);
  // Same self-escalation guard as the role-change route above: only an owner may pre-approve
  // someone as an owner.
  if (body.role === 'owner' && caller.role !== 'owner') return c.json({ error: 'Only an owner can invite as owner' }, 403);

  const existingUser = await userRepo.findByEmail(email);
  if (existingUser) return c.json({ error: 'This email already has an account in this workspace' }, 409);
  if (await workspaceRepo.getInviteByEmail(email)) return c.json({ error: 'This email is already invited' }, 409);

  const workspace = await workspaceRepo.getWorkspace();
  const invite = await workspaceRepo.createInvite({
    id: `invite_${randomUUID()}`,
    workspaceId: workspace.id,
    email,
    role: body.role,
    invitedBy: c.get('user').id,
    createdAt: new Date().toISOString(),
  });
  return c.json(invite, 201);
});

/** DELETE /api/workspace-invites/:id — revoke a pending invite. Only owners/admins may do this. */
workspaceRouter.delete('/workspace-invites/:id', async (c) => {
  const caller = await requireAdmin(c);
  if (!caller) return c.json({ error: 'Only workspace owners/admins can revoke invites' }, 403);
  await workspaceRepo.deleteInvite(c.req.param('id'));
  return c.json({ ok: true });
});
