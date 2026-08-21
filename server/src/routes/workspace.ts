import { Hono } from 'hono';
import type { WorkspaceRole } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { workspaceRepo } from '../container';

/** Workspace membership — who's in this workspace and what role they hold. No invite flow yet; membership is assigned at signup (see routes/auth.ts). */
export const workspaceRouter = new Hono<{ Variables: AuthVariables }>();

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];

workspaceRouter.get('/workspace-members', async (c) => c.json(await workspaceRepo.listMembers()));

/** PATCH /api/workspace-members/:userId — change a member's role. Only owners/admins may do this. */
workspaceRouter.patch('/workspace-members/:userId', async (c) => {
  const targetId = c.req.param('userId');
  const caller = await workspaceRepo.getMember(c.get('user').id);
  if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
    return c.json({ error: 'Only workspace owners/admins can change roles' }, 403);
  }
  const target = await workspaceRepo.getMember(targetId);
  if (!target) return c.json({ error: 'Not a member of this workspace' }, 404);

  const body = await c.req.json<{ role: WorkspaceRole }>();
  if (!ROLES.includes(body.role)) return c.json({ error: 'Invalid role' }, 400);

  // Only an owner may grant ownership — an admin promoting themselves (or anyone else) to
  // owner would be a self-escalation with no check above it.
  if (body.role === 'owner' && caller.role !== 'owner') {
    return c.json({ error: 'Only an owner can grant ownership' }, 403);
  }
  // Never let the workspace end up with zero owners — there'd be no path back, since signup
  // only grants 'owner' when the workspace has no members yet.
  if (target.role === 'owner' && body.role !== 'owner') {
    const owners = (await workspaceRepo.listMembers()).filter((m) => m.role === 'owner');
    if (owners.length <= 1) return c.json({ error: "Can't remove the workspace's last owner" }, 400);
  }

  const workspace = await workspaceRepo.getWorkspace();
  return c.json(await workspaceRepo.updateMemberRole(workspace.id, targetId, body.role));
});
